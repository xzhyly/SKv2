<?php
// Bulk video importer cache (bulk-import phase, docs/reports/2026-10-13-bulk-import-step1.md).
// Files only, all under <repo>/bulk_import_cache/ (git-ignored, laptop only, created on demand):
//   videos/<id>.meta.json, videos/<id>.hands.json, candidates/<key>/<SIGNER>.json (the clip) and
//   candidates/<key>/<SIGNER>.info.json (its small summary), picks.json (+ picks.lock)
// A candidate carries the SET (ESL | FSL | BOTH) of the video it was made from: a clip of an ESL
// video must never become the avatar clip of a sign that exists as FSL (the pages check it).
// GET  ?action=index | hands&id= | candidates[&key=] | candidate&key=&signer= | picks
// POST {action: put_video | put_candidate | delete_video | delete_candidates | set_picks, ...}
// Nothing is read or written anywhere else: every id / key / signer is validated before a path is
// built from it. saved_gestures is never touched here (an avatar clip is only written by
// avatar_clip.php). No DB access. No auth: demo system (docs/system/DEBT.md item 72).
header('Content-Type: application/json');

const BULK_VIDEO_MAX_BYTES = 8388608;    // request body of put_video
const BULK_MAX_BYTES = 1048576;          // request body of every other action
const BULK_CLIP_FORMAT = 'sk_avatar_clip_v1';
const BULK_ID_RE = '/^[0-9a-f]{32}\z/';
const BULK_SIGNER_RE = '/^P(0[1-9]|[1-9][0-9])\z/';
const BULK_KEY_MAX = 100;
const BULK_SETS = ['ESL', 'FSL', 'BOTH'];
// Windows device names: a folder of that name cannot be created (and "nul" swallows a write).
const BULK_DEVICE_RE = '/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\z/';
const BULK_JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
const BULK_GET_ACTIONS = ['index', 'hands', 'candidates', 'candidate', 'picks'];
const BULK_POST_ACTIONS = ['put_video', 'put_candidate', 'delete_video', 'delete_candidates', 'set_picks'];

require_once __DIR__ . '/sign_meta.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

// {success:true, ...$data}. JSON is always decoded to stdClass in this file (never to PHP arrays),
// so "{}" stays an object and a numeric sign key such as "1" stays an object key.
function done(array $data) {
    $json = json_encode(['success' => true] + $data, BULK_JSON_FLAGS);
    if ($json === false) {
        fail('Unable to encode the response', 500);
    }
    echo $json;
    exit;
}

function valid_id($v) {
    return is_string($v) && preg_match(BULK_ID_RE, $v) === 1;
}
function valid_key($v) {
    return is_string($v) && $v !== '' && strlen($v) <= BULK_KEY_MAX && clean_label($v) === $v
        && preg_match(BULK_DEVICE_RE, $v) !== 1;
}
function valid_signer($v) {
    return is_string($v) && preg_match(BULK_SIGNER_RE, $v) === 1;
}
function valid_set($v) {
    return is_string($v) && in_array($v, BULK_SETS, true);
}

// <repo>/bulk_import_cache[/<sub>]. $sub is only ever a constant or built from validated parts.
function cache_path($sub = '') {
    $root = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'bulk_import_cache';
    return $sub === '' ? $root : $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $sub);
}

function ensure_dir($dir) {
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('Unable to create the cache folder', 500);
    }
}

// Decoded JSON file (objects as stdClass), or null when missing / unreadable / invalid.
function read_json($file) {
    if (!is_file($file)) {
        return null;
    }
    $raw = @file_get_contents($file);
    return $raw === false ? null : json_decode($raw);
}

// Atomic: write a temp file next to the target, then rename over it. Warnings are silenced
// everywhere in this file: a printed warning would break the JSON answer and show a server path.
function write_atomic($file, $value) {
    $json = json_encode($value, BULK_JSON_FLAGS);
    if ($json === false) {
        fail('Unable to encode the data', 500);
    }
    ensure_dir(dirname($file));
    $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        @unlink($tmp);
        fail('Unable to write the cache file', 500);
    }
    // On Windows a rename over a file being read at that moment can fail: retry a few times.
    for ($try = 0; !@rename($tmp, $file); $try++) {
        if ($try >= 4) {
            @unlink($tmp);
            fail('Unable to write the cache file', 500);
        }
        usleep(50000);
    }
    return strlen($json);
}

// picks.json as a stdClass ({} when the file does not exist yet).
function read_picks() {
    $file = cache_path('picks.json');
    if (!is_file($file)) {
        return new stdClass();
    }
    $picks = read_json($file);
    if (!($picks instanceof stdClass)) {
        fail('picks.json is unreadable', 500);
    }
    return $picks;
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';

// ---------------------------------------------------------------- GET
if ($method === 'GET') {
    $action = $_GET['action'] ?? null;
    if (in_array($action, BULK_POST_ACTIONS, true)) {
        fail('POST only', 405);
    }

    if ($action === 'index') {
        // Only the small *.meta.json files are read (about 1000 of them for the full dataset).
        $videos = new stdClass();
        $dir = cache_path('videos');
        foreach (is_dir($dir) ? (@scandir($dir) ?: []) : [] as $name) {
            if (substr($name, -10) !== '.meta.json') {
                continue;
            }
            $id = substr($name, 0, -10);
            if (!valid_id($id)) {
                continue;
            }
            $meta = read_json($dir . DIRECTORY_SEPARATOR . $name);
            if ($meta instanceof stdClass) {
                $videos->{$id} = $meta;
            }
        }
        done(['videos' => $videos]);
    }

    if ($action === 'hands') {
        $id = $_GET['id'] ?? null;
        if (!valid_id($id)) {
            fail('Invalid id');
        }
        $hands = read_json(cache_path("videos/$id.hands.json"));
        if (!($hands instanceof stdClass)) {
            fail('No hands data for this video', 404);
        }
        // The file's own fields (id, meta, reps) at the top level, next to success (a stored
        // "success" field can never replace the real one).
        $fields = get_object_vars($hands);
        unset($fields['success']);
        done($fields);
    }

    if ($action === 'candidates') {
        // Reads only the small *.info.json summaries, never a clip. &key= lists one sign.
        $only = $_GET['key'] ?? null;
        if ($only !== null && !valid_key($only)) {
            fail('Invalid key');
        }
        $out = new stdClass();
        $root = cache_path('candidates');
        $keys = $only !== null ? [$only] : (is_dir($root) ? (@scandir($root) ?: []) : []);   // scandir sorts by name
        foreach ($keys as $key) {
            $key = (string)$key;
            $dir = $root . DIRECTORY_SEPARATOR . $key;
            $list = [];
            foreach (valid_key($key) && is_dir($dir) ? (@scandir($dir) ?: []) : [] as $name) {
                $signer = substr($name, 0, -10);
                if (substr($name, -10) !== '.info.json' || !valid_signer($signer)) {
                    continue;
                }
                $info = read_json($dir . DIRECTORY_SEPARATOR . $name);
                if (!($info instanceof stdClass)) {
                    continue;
                }
                $list[] = [
                    'signer'   => $signer,
                    // null: a summary written without a set (unknown; the pages treat it as usable)
                    'set'      => valid_set($info->set ?? null) ? $info->set : null,
                    'frames'   => $info->frames ?? null,
                    'videoId'  => $info->videoId ?? null,
                    'repIndex' => $info->repIndex ?? null,
                    'savedAt'  => $info->savedAt ?? null,
                ];
            }
            if ($list || $only !== null) {
                $out->{$key} = $list;
            }
        }
        done(['candidates' => $out]);
    }

    if ($action === 'candidate') {
        $key = $_GET['key'] ?? null;
        $signer = $_GET['signer'] ?? null;
        if (!valid_key($key)) {
            fail('Invalid key');
        }
        if (!valid_signer($signer)) {
            fail('signer must be P01..P99');
        }
        $file = cache_path("candidates/$key/$signer.json");
        if (!is_file($file)) {
            fail('No candidate for this sign and signer', 404);
        }
        $c = read_json($file);
        if (!($c instanceof stdClass)) {
            fail('The cached candidate is unreadable', 500);
        }
        $c->set = valid_set($c->set ?? null) ? $c->set : null;
        done(['candidate' => $c]);
    }

    if ($action === 'picks') {
        done(['picks' => read_picks()]);
    }

    fail('Unknown action');
}

// ---------------------------------------------------------------- POST
if ($method !== 'POST') {
    fail('GET or POST only', 405);
}

$raw = (string)file_get_contents('php://input', false, null, 0, BULK_VIDEO_MAX_BYTES + 1);
if (strlen($raw) > BULK_VIDEO_MAX_BYTES) {
    fail('Request too large (max 8 MB)', 413);
}
$body = json_decode($raw);
if (!($body instanceof stdClass)) {
    fail('Invalid JSON body');
}
$action = $body->action ?? null;
if (in_array($action, BULK_GET_ACTIONS, true)) {
    fail('GET only', 405);
}
if (!in_array($action, BULK_POST_ACTIONS, true)) {
    fail('Unknown action');
}
if ($action !== 'put_video' && strlen($raw) > BULK_MAX_BYTES) {
    fail('Request too large (max 1 MB)', 413);
}
unset($raw);

if ($action === 'put_video') {
    $id = $body->id ?? null;
    if (!valid_id($id)) {
        fail('Invalid id');
    }
    $meta = $body->meta ?? null;
    if (!($meta instanceof stdClass)) {
        fail('meta must be an object');
    }
    if (($meta->id ?? null) !== $id) {
        fail('meta id does not match');
    }
    $hands = $body->hands ?? null;
    if ($hands !== null) {
        if (!($hands instanceof stdClass)) {
            fail('hands must be an object');
        }
        if (($hands->id ?? null) !== $id) {
            fail('hands id does not match');
        }
    }
    // Hands first: a video listed by `index` (meta present) then always has its hands file.
    $bytes = 0;
    if ($hands !== null) {
        $bytes += write_atomic(cache_path("videos/$id.hands.json"), $hands);
    }
    $bytes += write_atomic(cache_path("videos/$id.meta.json"), $meta);
    done(['id' => $id, 'hands' => $hands !== null, 'bytes' => $bytes]);
}

if ($action === 'put_candidate') {
    $key = $body->key ?? null;
    $signer = $body->signer ?? null;
    $videoId = $body->videoId ?? null;
    $repIndex = $body->repIndex ?? null;
    $clip = $body->clip ?? null;
    $set = $body->set ?? null;
    if (!valid_key($key)) {
        fail('Invalid key');
    }
    if (!valid_signer($signer)) {
        fail('signer must be P01..P99');
    }
    if (!valid_set($set)) {
        fail('set must be ESL, FSL or BOTH');
    }
    if (!valid_id($videoId)) {
        fail('Invalid videoId');
    }
    if (!is_int($repIndex) || $repIndex < 0) {
        fail('repIndex must be a whole number');
    }
    // Shape only; the full clip validation runs in the browser and again in avatar_clip.php when
    // the clip is used. (A JSON array decodes to a PHP list here, a JSON object does not.)
    if (!($clip instanceof stdClass)) {
        fail('Invalid clip: clip must be an object');
    }
    if (($clip->format ?? null) !== BULK_CLIP_FORMAT) {
        fail('Invalid clip: format must be ' . BULK_CLIP_FORMAT);
    }
    if (!is_array($clip->frames ?? null) || count($clip->frames) < 1) {
        fail('Invalid clip: no frames');
    }
    $savedAt = gmdate('c');
    // The clip first, then its summary: a listed candidate always has its clip file.
    $bytes = write_atomic(cache_path("candidates/$key/$signer.json"), [
        'videoId'  => $videoId,
        'repIndex' => $repIndex,
        'savedAt'  => $savedAt,
        'set'      => $set,
        'clip'     => $clip,
    ]);
    write_atomic(cache_path("candidates/$key/$signer.info.json"), [
        'signer'   => $signer,
        'set'      => $set,
        'frames'   => count($clip->frames),
        'videoId'  => $videoId,
        'repIndex' => $repIndex,
        'savedAt'  => $savedAt,
    ]);
    done(['key' => $key, 'signer' => $signer, 'set' => $set, 'frames' => count($clip->frames), 'savedAt' => $savedAt, 'bytes' => $bytes]);
}

if ($action === 'delete_video') {
    $id = $body->id ?? null;
    if (!valid_id($id)) {
        fail('Invalid id');
    }
    $deleted = false;
    foreach (['meta', 'hands'] as $part) {
        $file = cache_path("videos/$id.$part.json");
        if (is_file($file)) {
            if (!@unlink($file)) {
                fail('Unable to delete the cached video', 500);
            }
            $deleted = true;
        }
    }
    done(['id' => $id, 'deleted' => $deleted]);
}

if ($action === 'delete_candidates') {
    $key = $body->key ?? null;
    if (!valid_key($key)) {
        fail('Invalid key');
    }
    $dir = cache_path("candidates/$key");
    $signers = [];                       // clip + summary of one signer count as one candidate
    if (is_dir($dir)) {
        foreach (@scandir($dir) ?: [] as $name) {
            $file = $dir . DIRECTORY_SEPARATOR . $name;
            if ($name === '.' || $name === '..' || !is_file($file)) {
                continue;
            }
            if (!@unlink($file)) {
                fail('Unable to delete the candidates', 500);
            }
            if (valid_signer(substr($name, 0, 3)) && preg_match('/^.{3}(\.info)?\.json\z/', $name) === 1) {
                $signers[substr($name, 0, 3)] = true;
            }
        }
        @rmdir($dir);
    }
    done(['key' => $key, 'deleted' => count($signers)]);
}

// set_picks: merge into picks.json; a null value removes the key. Everything is validated before
// anything is written. Read -> merge -> write runs under an exclusive lock (picks.lock), so
// simultaneous requests cannot lose each other's keys. An empty change set writes nothing.
$changes = $body->picks ?? null;
if (!($changes instanceof stdClass)) {
    fail('picks must be an object');
}
$at = gmdate('c');
$set = [];
foreach (get_object_vars($changes) as $key => $pick) {
    $key = (string)$key;
    if (!valid_key($key)) {
        fail('Invalid key');
    }
    if ($pick === null) {
        $set[$key] = null;
        continue;
    }
    if (!($pick instanceof stdClass)) {
        fail('A pick must be {signer, by} or null');
    }
    if (!valid_signer($pick->signer ?? null)) {
        fail('signer must be P01..P99');
    }
    $by = $pick->by ?? null;
    if ($by !== 'hand' && $by !== 'default') {
        fail('by must be hand or default');
    }
    $set[$key] = ['signer' => $pick->signer, 'by' => $by, 'at' => $at];
}
if (!$set) {
    done(['picks' => read_picks()]);
}
ensure_dir(cache_path());
$lock = @fopen(cache_path('picks.lock'), 'c');
if ($lock === false || !flock($lock, LOCK_EX)) {
    fail('Unable to lock picks.json', 500);
}
$picks = read_picks();
foreach ($set as $key => $pick) {
    $key = (string)$key;
    if ($pick === null) {
        unset($picks->{$key});
    } else {
        $picks->{$key} = (object)$pick;
    }
}
write_atomic(cache_path('picks.json'), $picks);
flock($lock, LOCK_UN);
fclose($lock);
done(['picks' => $picks]);
