<?php
// Shared helpers for a sign's metadata (set ESL|FSL|BOTH + English/Filipino text). The disk file
// saved_gestures/<key>/sign.json is the source of truth; the gestures table mirrors it.
// Pure functions only -- no output, no DB access, no fail() -- so any endpoint can require_once it.

const SIGN_SETS = ['ESL', 'FSL', 'BOTH'];
const SIGN_TEXT_MAX = 255;

if (!function_exists('clean_label')) {
    function clean_label($label) {
        $label = strtolower(trim((string)$label));
        $label = preg_replace('/\s+/', '_', $label);
        $label = preg_replace('/[^a-z0-9_-]/', '', $label);
        return trim($label, '_-');
    }
}

// "kamusta_ka" -> "Kamusta ka"
function sign_draft_text($label) {
    $text = str_replace('_', ' ', (string)$label);
    if ($text === '') {
        return '';
    }
    return mb_strtoupper(mb_substr($text, 0, 1)) . mb_substr($text, 1);
}

// 'esl' / ' BOTH ' -> 'ESL' / 'BOTH'; anything else -> null.
function valid_sign_set($value) {
    if (!is_string($value)) {
        return null;
    }
    $value = strtoupper(trim($value));
    return in_array($value, SIGN_SETS, true) ? $value : null;
}

// Decoded sign.json of a label folder, or null (missing file, unreadable, invalid JSON).
function read_sign_json($dir) {
    $file = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . 'sign.json';
    if (!is_file($file)) {
        return null;
    }
    $raw = @file_get_contents($file);
    if ($raw === false) {
        return null;
    }
    $json = json_decode($raw, true);
    return is_array($json) ? $json : null;
}

// Writes sign.json (keys exactly key,set,textEn,textFil,updatedAt). Returns false on failure.
function write_sign_json($dir, $key, $set, $textEn, $textFil) {
    $file = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . 'sign.json';
    $data = [
        'key'       => $key,
        'set'       => $set,
        'textEn'    => $textEn,
        'textFil'   => $textFil,
        'updatedAt' => gmdate('c'),
    ];
    $encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        return false;
    }
    return file_put_contents($file, $encoded, LOCK_EX) !== false;
}

// A sign's {set, textEn, textFil}. $folderName is 'saved_gestures' or 'saved_gestures_fsl'.
// Uses sign.json when present and valid (set in ESL|FSL|BOTH); otherwise derives the set from the
// folder (or the first sample's signLanguage when that is ESL/FSL) and a draft text for it.
// Whatever the source, a text the set requires is never empty (draft fallback), so the result
// always satisfies the gestures CHECK constraint.
function derive_sign($folderName, $label, $dir) {
    $meta = read_sign_json($dir);
    $set = is_array($meta) ? valid_sign_set($meta['set'] ?? null) : null;
    if ($set !== null) {
        $textEn  = isset($meta['textEn'])  && is_string($meta['textEn'])  && $meta['textEn']  !== '' ? $meta['textEn']  : null;
        $textFil = isset($meta['textFil']) && is_string($meta['textFil']) && $meta['textFil'] !== '' ? $meta['textFil'] : null;
    } else {
        $set = ($folderName === 'saved_gestures_fsl') ? 'FSL' : 'ESL';
        $first = glob(rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . 'sample_*.json') ?: [];
        if ($first) {
            $sample = json_decode((string)@file_get_contents($first[0]), true);
            if (is_array($sample)) {
                $sl = strtoupper(trim((string)($sample['signLanguage'] ?? $sample['sign_language'] ?? '')));
                if ($sl === 'ESL' || $sl === 'FSL') {
                    $set = $sl;
                }
            }
        }
        $textEn  = $set === 'ESL' ? sign_draft_text($label) : null;
        $textFil = $set === 'FSL' ? sign_draft_text($label) : null;
    }
    if ($set !== 'FSL' && $textEn === null) {
        $textEn = sign_draft_text($label);
    }
    if ($set !== 'ESL' && $textFil === null) {
        $textFil = sign_draft_text($label);
    }
    return ['set' => $set, 'textEn' => $textEn, 'textFil' => $textFil];
}

// Text field from a request value: trimmed string, or null when absent/empty. Returns
// [value, error] -- error is a message when the value is present but not a string or too long.
function sign_text_field($value, $fieldName) {
    if ($value === null) {
        return [null, null];
    }
    if (!is_string($value)) {
        return [null, "$fieldName must be a string"];
    }
    $value = trim($value);
    if ($value === '') {
        return [null, null];
    }
    if (mb_strlen($value) > SIGN_TEXT_MAX) {
        return [null, "$fieldName is too long (max " . SIGN_TEXT_MAX . ' characters)'];
    }
    return [$value, null];
}
