<?php
// Suppress PHP warnings/notices to prevent them from corrupting JSON API responses
error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../connect.php';

function fail($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

function clean_label($label) {
    $label = strtolower(trim((string)$label));
    $label = preg_replace('/\s+/', '_', $label);
    $label = preg_replace('/[^a-z0-9_-]/', '', $label);
    return trim($label, '_-');
}

function map_digit_to_word($label, $lang) {
    $digitToWordEn = [
        '1' => 'one', '2' => 'two', '3' => 'three', '4' => 'four', '5' => 'five',
        '6' => 'six', '7' => 'seven', '8' => 'eight', '9' => 'nine', '10' => 'ten'
    ];
    $digitToWordFil = [
        '1' => 'isa', '2' => 'dalawa', '3' => 'tatlo', '4' => 'apat', '5' => 'lima',
        '6' => 'anim', '7' => 'pito', '8' => 'walo', '9' => 'siyam', '10' => 'sampu'
    ];
    
    $cleanLabel = str_replace('_', ' ', $label);
    $cleanLabel = strtolower(trim($cleanLabel));
    
    if (isset($digitToWordEn[$cleanLabel])) {
        return ($lang === 'FSL') ? $digitToWordFil[$cleanLabel] : $digitToWordEn[$cleanLabel];
    }
    
    if ($lang === 'FSL') {
        $enToFil = array_combine(array_values($digitToWordEn), array_values($digitToWordFil));
        if (isset($enToFil[$cleanLabel])) {
            return $enToFil[$cleanLabel];
        }
    }
    
    return $label;
}

// Locate FFmpeg binary on the server
function get_ffmpeg_path() {
    // 1. Check if global ffmpeg works
    $test = shell_exec('ffmpeg -version 2>&1');
    if (strpos($test, 'ffmpeg version') !== false) {
        return 'ffmpeg';
    }
    
    // 2. Check local directories
    $local_paths = [
        __DIR__ . '/../../ffmpeg.exe',
        __DIR__ . '/../../bin/ffmpeg.exe',
        'C:\ffmpeg\bin\ffmpeg.exe'
    ];
    foreach ($local_paths as $p) {
        if (file_exists($p)) {
            return '"' . $p . '"';
        }
    }
    return null;
}

$action = $_GET['action'] ?? '';

if ($action === 'convert_video') {
    if (empty($_FILES['video'])) {
        fail('No video file uploaded.');
    }
    $label = clean_label($_POST['label'] ?? '');
    if (empty($label)) {
        fail('Label/Word is required.');
    }
    
    $ffmpeg = get_ffmpeg_path();
    if (!$ffmpeg) {
        fail('FFmpeg is not installed or not found. Please place ffmpeg.exe inside the project root directory.');
    }

    $temp_file = $_FILES['video']['tmp_name'];
    
    $signLanguage = strtoupper(trim((string)($_POST['sign_language'] ?? 'ESL')));
    if (!in_array($signLanguage, ['ESL', 'FSL'], true)) {
        $signLanguage = 'ESL';
    }
    $subFolder = ($signLanguage === 'FSL') ? 'fil' : 'en';

    // Ensure signs directory exists
    $signs_dir = __DIR__ . '/../../assets/signs/' . $subFolder;
    if (!is_dir($signs_dir)) {
        mkdir($signs_dir, 0775, true);
    }
    
    $output_filename = $label . '.webm';
    $output_path = $signs_dir . DIRECTORY_SEPARATOR . $output_filename;
    
    // Run FFmpeg conversion to WebM VP8 360p no audio (Raspberry Pi optimized)
    $cmd = "$ffmpeg -i " . escapeshellarg($temp_file) . " -vf \"scale=360:-2\" -c:v libvpx -r 15 -b:v 350k -an " . escapeshellarg($output_path) . " -y 2>&1";
    $output = [];
    $retval = 0;
    exec($cmd, $output, $retval);
    
    if ($retval !== 0 || !file_exists($output_path) || filesize($output_path) === 0) {
        fail('FFmpeg conversion failed: ' . implode("\n", $output));
    }
    
    echo json_encode([
        'success' => true,
        'label' => $label,
        'video_url' => 'assets/signs/' . $subFolder . '/' . $output_filename
    ]);
    exit;
}

if ($action === 'check_duplicate') {
    $label = clean_label($_GET['label'] ?? '');
    $signLanguage = strtoupper(trim((string)($_GET['sign_language'] ?? 'ESL')));
    if (empty($label)) {
        fail('Label is required.');
    }

    if ($signLanguage === 'BOTH') {
        // Resolve labels for ESL and FSL dynamically
        $eslLabel = clean_label(map_digit_to_word($label, 'ESL'));
        $fslLabel = clean_label(map_digit_to_word($label, 'FSL'));

        $stmt = mysqli_prepare($conn, "SELECT COUNT(*) FROM gestures WHERE (word = ? AND sign_language = 'ESL') OR (word = ? AND sign_language = 'FSL')");
        mysqli_stmt_bind_param($stmt, 'ss', $eslLabel, $fslLabel);
        mysqli_stmt_execute($stmt);
        $res = mysqli_stmt_get_result($stmt);
        $row = mysqli_fetch_row($res);
        $count = (int)($row[0] ?? 0);
        mysqli_stmt_close($stmt);
        
        $exists = ($count >= 2);
        
        // Return resolved ESL label back to UI
        $label = $eslLabel;
    } else {
        // Standard check
        $resolvedLabel = clean_label(map_digit_to_word($label, $signLanguage));
        $stmt = mysqli_prepare($conn, "SELECT id FROM gestures WHERE word = ? AND sign_language = ? LIMIT 1");
        mysqli_stmt_bind_param($stmt, 'ss', $resolvedLabel, $signLanguage);
        mysqli_stmt_execute($stmt);
        $res = mysqli_stmt_get_result($stmt);
        $exists = (mysqli_num_rows($res) > 0);
        mysqli_stmt_close($stmt);
        
        $label = $resolvedLabel;
    }

    echo json_encode([
        'success' => true,
        'exists' => $exists,
        'label' => $label,
        'sign_language' => $signLanguage
    ]);
    exit;
}

if ($action === 'save_landmarks') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        fail('Invalid JSON body');
    }
    
    $label = clean_label($body['label'] ?? '');
    $signLanguage = strtoupper(trim((string)($body['sign_language'] ?? 'ESL')));
    if (!in_array($signLanguage, ['ESL', 'FSL', 'BOTH'], true)) {
        $signLanguage = 'ESL';
    }
    $frames = $body['frames'] ?? null;
    $video_path = $body['video_path'] ?? null;
    
    if (empty($label)) fail('Label/Word is required.');
    if (!is_array($frames) || count($frames) === 0) fail('No landmark frames provided.');

    // Helper function to translate English text to Tagalog/Filipino via MyMemory API
    function translate_english_to_tagalog($englishText) {
        // Clean label underscores for proper translation dictionary matching (e.g. "how_are_you" -> "how are you")
        $queryText = str_replace('_', ' ', $englishText);
        $lowerQuery = strtolower(trim($queryText));
        
        // 1. If it's a single letter or a numeric digit/number (like 1-10), do not translate (return as is)
        if (preg_match('/^[a-z]$/', $lowerQuery) || preg_match('/^\d+$/', $lowerQuery)) {
            return $lowerQuery;
        }

        // Local dictionary fallback for common signs to prevent weird API translations
        $localDict = [
            'one' => 'isa',
            'two' => 'dalawa',
            'three' => 'tatlo',
            'four' => 'apat',
            'five' => 'lima',
            'six' => 'anim',
            'seven' => 'pito',
            'eight' => 'walo',
            'nine' => 'siyam',
            'ten' => 'sampu',
            'how are you' => 'kamusta ka',
            'good morning' => 'magandang umaga',
            'good afternoon' => 'magandang hapon',
            'good evening' => 'magandang gabi',
            'thank you' => 'salamat',
            'welcome' => 'walang anuman',
            'please' => 'pakiusap',
            'excuse me' => 'pasintabi',
            'sorry' => 'paumanhin',
            'yes' => 'oo',
            'no' => 'hindi',
            'hello' => 'kamusta',
            'goodbye' => 'paalam',
            'what' => 'ano',
            'who' => 'sino',
            'where' => 'saan',
            'when' => 'kailan',
            'why' => 'bakit',
            'how' => 'paano',
            'my' => 'aking',
            'know' => 'alam',
            'which' => 'alin',
            'father' => 'ama',
            'daughter' => 'anak babae',
            'son' => 'anak lalaki',
            'what did you say' => 'ano ba ang sabi mo',
            'what time is it' => 'anong oras na',
            'day' => 'araw',
            'wife' => 'asawa babae',
            'husband' => 'asawa lalaki',
            'dog' => 'aso',
            'sister' => 'ate',
            'dont want' => 'ayaw ko',
            'don\'t want' => 'ayaw ko',
            'house' => 'bahay',
            'toilet' => 'banyo',
            'bathroom' => 'banyo',
            'boyfriend' => 'boyfriend',
            'tomorrow' => 'bukas',
            'month' => 'buwan',
            'age' => 'edad',
            'night' => 'gabi',
            'make' => 'gagawa',
            'will make' => 'gagawa',
            'will' => 'gagawa',
            'girlfriend' => 'girlfriend',
            'like' => 'gusto',
            'want' => 'gusto',
            'come' => 'halika',
            'come here' => 'halika',
            'afternoon' => 'hapon',
            'more' => 'higit pa',
            'dont know' => 'hindi ko alam',
            'don\'t know' => 'hindi ko alam',
            'dont like' => 'hindi ko gusto',
            'don\'t like' => 'hindi ko gusto',
            'last' => 'huli',
            'late' => 'huli',
            'give' => 'ibigay',
            'nice' => 'maganda',
            'nice to meet you' => 'ikinagagalak kitang makilala',
            'mother' => 'ina',
            'take care' => 'ingat',
            'yesterday' => 'kahapon',
            'friend' => 'kaibigan',
            'need' => 'kailangan',
            'eat' => 'kainan',
            'restaurant' => 'kainan',
            'weekend' => 'katapusan ng linggo',
            'see you later' => 'kita tayo mamaya',
            'brother' => 'kuya',
            'chat' => 'kwentuhan',
            'sunday' => 'linggo',
            'week' => 'linggo',
            'grandmother' => 'lola',
            'grandfather' => 'lolo',
            'grow up' => 'lumaki',
            'student' => 'mag aaral',
            'beautiful' => 'maganda',
            'retire' => 'magretiro',
            'practice' => 'magsanay',
            'love' => 'mahal',
            'i love this' => 'mahal ko ito',
            'meet' => 'makipagkita',
            'see' => 'makita',
            'later' => 'mamaya',
            'past' => 'nakaraan',
            'where is the toilet' => 'nasaan ang banyo',
            'where is the bathroom' => 'nasaan ang banyo',
            'time' => 'oras',
            'say' => 'sabihin',
            'question' => 'tanong',
            'ask' => 'tanong',
            'year' => 'taon',
            'then' => 'tapos',
            'done' => 'tapos',
            'finished' => 'tapos na',
            'already done' => 'tapos na',
            'work' => 'trabaho',
            'help' => 'tulong',
            'help me practice' => 'tulungan mo akong magsanay',
            'help me practice please' => 'tulungan mo akong magsanay',
            'favorite' => 'paborito',
            'go' => 'pumunta',
            'morning' => 'umaga',
            
            // --- BATCH 2 SPECIFIC TRANSLATIONS ---
            'angry' => 'magkasingkahulugan ng galit',
            'are you hearing' => 'naririnig mo ba',
            'bad' => 'masama',
            'bored' => 'bored',
            'busy' => 'abala',
            'confused' => 'nalilito',
            'deaf' => 'bingi',
            'do you understand' => 'naiintindihan mo ba',
            'excited' => 'nasasabik ako',
            'im excited' => 'nasasabik ako',
            'i\'m excited' => 'nasasabik ako',
            'fine' => 'mabuti',
            'happy' => 'masaya',
            'hard of hearing' => 'mahirap makarinig',
            'hearing' => 'nakakarinig',
            'learn' => 'matuto',
            'live' => 'nakatira',
            'my name' => 'aking pangalan',
            'name' => 'pangalan',
            'nothing' => 'wala',
            'no i dont understand' => 'hindi ko naiintindihan',
            'no i don\'t understand' => 'hindi ko naiintindihan',
            'sad' => 'malungkot',
            'scared' => 'takot',
            'sick' => 'may sakit',
            'sleepy' => 'inaantok',
            'so so' => 'katamtaman',
            'tired' => 'pagod',
            'understand' => 'naiintindihan',
            'usual' => 'karaniwan',
            'what is your name' => 'anong pangalan mo',
            'where do you live' => 'saan ka nakatira',
            'yes you can help me' => 'oo pwede mo akong tulungan',
            'you' => 'ikaw',
            
            // --- ADDITIONAL CUSTOM FSL PHRASE MAPPINGS ---
            'nothing will happen if i dont try' => 'wala naman mangyayari kung hindi ko susubukan',
            'nothing will happen if i don\'t try' => 'wala naman mangyayari kung hindi ko susubukan',
            'i found nothing' => 'wala akong nahanap',
            'do they understand english' => 'nakakaintindi ba sila ng english',
            'deep tagalog' => 'malalim na tagalog',
            'waiting for the right' => 'hinihintay ang kanan',
            'peeping tom' => 'boso',
            'give me one more chance' => 'bigyan mo pa ako ng isang pagkakataon',
            'making meaning' => 'paggawa ng kahulugan',
            'send this' => 'ipadala ito'
        ];

        if (isset($localDict[$lowerQuery])) {
            return $localDict[$lowerQuery];
        }

        // Call MyMemory Public Translation API (English to Tagalog)
        $url = 'https://api.mymemory.translated.net/get?q=' . urlencode($queryText) . '&langpair=en|tl';
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        $response = curl_exec($ch);
        curl_close($ch);

        if ($response) {
            $json = json_decode($response, true);
            if (isset($json['responseData']['translatedText'])) {
                $translated = $json['responseData']['translatedText'];
                // Remove API warning templates or matching issues if any
                if (stripos($translated, 'mymemory') === false) {
                    return $translated;
                }
            }
        }
        return $queryText; // Fallback to original text if API fails
    }

    // Determine target languages to process
    $languagesToProcess = [];
    if ($signLanguage === 'BOTH') {
        $eslLabel = clean_label(map_digit_to_word($label, 'ESL'));
        $languagesToProcess[] = ['lang' => 'ESL', 'label' => $eslLabel];
        
        // Translate label for FSL
        $translated = translate_english_to_tagalog($eslLabel);
        $fslLabel = clean_label($translated);
        $languagesToProcess[] = ['lang' => 'FSL', 'label' => $fslLabel];
    } else {
        $targetLabel = clean_label(map_digit_to_word($label, $signLanguage));
        $languagesToProcess[] = ['lang' => $signLanguage, 'label' => $targetLabel];
    }

    $results = [];

    foreach ($languagesToProcess as $proc) {
        $targetLang = $proc['lang'];
        $targetLabel = $proc['label'];

        // Dynamic duplication check: Skip saving this language if this gesture word already exists
        $dup_chk = mysqli_prepare($conn, "SELECT id FROM gestures WHERE word = ? AND sign_language = ? LIMIT 1");
        mysqli_stmt_bind_param($dup_chk, 'ss', $targetLabel, $targetLang);
        mysqli_stmt_execute($dup_chk);
        $dup_res = mysqli_stmt_get_result($dup_chk);
        $already_exists = (mysqli_num_rows($dup_res) > 0);
        mysqli_stmt_close($dup_chk);

        if ($already_exists) {
            $results[] = [
                'signLanguage' => $targetLang,
                'label' => $targetLabel,
                'status' => 'skipped',
                'message' => 'Already exists in database'
            ];
            continue; // Skip file writing and database insert for this language copy
        }

        // Determine destination folder (saved_gestures for ESL, saved_gestures_fsl for FSL)
        $folderName = ($targetLang === 'FSL') ? 'saved_gestures_fsl' : 'saved_gestures';
        $datasetRoot = realpath(__DIR__ . '/../../' . $folderName);
        if ($datasetRoot === false) {
            $datasetRoot = __DIR__ . '/../../' . $folderName;
            mkdir($datasetRoot, 0775, true);
            $datasetRoot = realpath($datasetRoot);
        }

        $labelDir = $datasetRoot . DIRECTORY_SEPARATOR . $targetLabel;
        if (!is_dir($labelDir)) {
            mkdir($labelDir, 0775, true);
        }

        $filename = 'sample_' . round(microtime(true) * 1000) . '_' . bin2hex(random_bytes(3)) . '.json';
        $path = $labelDir . DIRECTORY_SEPARATOR . $filename;

        $recording = [
            'label' => $targetLabel,
            'createdAt' => gmdate('c'),
            'frameCount' => count($frames),
            'format' => 'mediapipe_hands_landmarks_v2',
            'signLanguage' => $targetLang,
            'frames' => $frames
        ];

        $encoded = json_encode($recording, JSON_PRETTY_PRINT);
        if ($encoded === false || file_put_contents($path, $encoded, LOCK_EX) === false) {
            fail("Unable to write gesture sample for $targetLang", 500);
        }

        // Save/Sync to gestures Table
        $stmt = mysqli_prepare($conn, 'INSERT INTO gestures (word, sign_language) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)');
        mysqli_stmt_bind_param($stmt, 'ss', $targetLabel, $targetLang);
        mysqli_stmt_execute($stmt);
        $gestureId = (int)mysqli_insert_id($conn);
        mysqli_stmt_close($stmt);

        if ($gestureId === 0) {
            $sel = mysqli_prepare($conn, 'SELECT id FROM gestures WHERE word = ? AND sign_language = ? LIMIT 1');
            mysqli_stmt_bind_param($sel, 'ss', $targetLabel, $targetLang);
            mysqli_stmt_execute($sel);
            $res = mysqli_stmt_get_result($sel);
            $row = mysqli_fetch_assoc($res);
            $gestureId = (int)($row['id'] ?? 0);
            mysqli_stmt_close($sel);
        }

        // Dictionary table (esl_signs / fsl_signs)
        $table = ($targetLang === 'FSL') ? 'fsl_signs' : 'esl_signs';
        $displayText = str_replace('_', ' ', $targetLabel);
        $description = $targetLang . ' user-added gesture sample.';

        // Adjust video path folder reference if copied to FSL
        $targetVideoPath = $video_path;
        if ($targetLang === 'FSL' && !empty($video_path)) {
            // For FSL, copy the video from en/ subfolder to fil/ subfolder
            $eslVideoFilename = basename($video_path);
            $fslVideoFilename = $targetLabel . '.webm';

            $srcSignsDir = realpath(__DIR__ . '/../../assets/signs/en');
            $destSignsDir = realpath(__DIR__ . '/../../assets/signs/fil');
            if ($destSignsDir === false) {
                $destSignsDir = __DIR__ . '/../../assets/signs/fil';
                mkdir($destSignsDir, 0775, true);
                $destSignsDir = realpath($destSignsDir);
            }

            if ($srcSignsDir !== false && $destSignsDir !== false) {
                $srcVideo = $srcSignsDir . DIRECTORY_SEPARATOR . $eslVideoFilename;
                $destVideo = $destSignsDir . DIRECTORY_SEPARATOR . $fslVideoFilename;

                if (file_exists($srcVideo) && !file_exists($destVideo)) {
                    @copy($srcVideo, $destVideo);
                }
            }
            $targetVideoPath = 'assets/signs/fil/' . $fslVideoFilename;
        }

        $insert = mysqli_prepare(
            $conn,
            "INSERT INTO `$table` (sign_key, sign_label, text_value, description, asset_path)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               sign_label = VALUES(sign_label),
               text_value = VALUES(text_value),
               description = VALUES(description),
               asset_path = IFNULL(VALUES(asset_path), asset_path)"
        );
        mysqli_stmt_bind_param($insert, 'sssss', $targetLabel, $displayText, $displayText, $description, $targetVideoPath);
        mysqli_stmt_execute($insert);
        $insert_success = mysqli_stmt_affected_rows($insert);
        mysqli_stmt_close($insert);

        // Save to gesture_recordings table
        $relativePath = $folderName . '/' . $targetLabel . '/' . $filename;
        $rec_insert = mysqli_prepare(
            $conn,
            'INSERT INTO gesture_recordings (gesture_id, sign_language, gesture_type, sample_count, sample_path, landmark_json)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        mysqli_stmt_bind_param($rec_insert, 'ississ', $gestureId, $targetLang, $targetLabel, $recording['frameCount'], $relativePath, $encoded);
        mysqli_stmt_execute($rec_insert);
        mysqli_stmt_close($rec_insert);

        $results[] = [
            'signLanguage' => $targetLang,
            'label' => $targetLabel,
            'status' => 'saved',
            'file' => $relativePath
        ];
    }

    mysqli_close($conn);

    echo json_encode([
        'success' => true,
        'processed' => $results
    ]);
    exit;
}

fail('Invalid action.');
?>
