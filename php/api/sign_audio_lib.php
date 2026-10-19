<?php
// Sign audio files (talk-turns-audio phase, docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md
// section 5): saved_gestures/<key>/audio_en.<ext> and audio_fil.<ext>, next to sign.json. At most one
// file per language (an upload replaces any other extension). Read by php/api/signs.php (GET `audio`)
// and written by php/api/sign_audio.php.

const SIGN_AUDIO_LANGS = ['en', 'fil'];
const SIGN_AUDIO_EXTS = ['webm', 'mp3', 'm4a', 'wav', 'ogg'];
const SIGN_AUDIO_MAX_BYTES = 2097152;   // 2 MB

// Existing audio files of one sign folder: ['en' => filename|null, 'fil' => filename|null].
function sign_audio_files($keyDir) {
    $out = ['en' => null, 'fil' => null];
    foreach (SIGN_AUDIO_LANGS as $lang) {
        foreach (SIGN_AUDIO_EXTS as $ext) {
            $name = 'audio_' . $lang . '.' . $ext;
            if (is_file($keyDir . DIRECTORY_SEPARATOR . $name)) {
                $out[$lang] = $name;
                break;
            }
        }
    }
    return $out;
}

// URLs (relative to the site root) of a sign's audio, with ?v=<mtime> so a re-recording is never
// served from the browser cache: ['en' => url|null, 'fil' => url|null].
function sign_audio_urls($key, $keyDir) {
    $urls = ['en' => null, 'fil' => null];
    foreach (sign_audio_files($keyDir) as $lang => $name) {
        if ($name !== null) {
            $urls[$lang] = 'saved_gestures/' . rawurlencode($key) . '/' . $name . '?v=' . filemtime($keyDir . DIRECTORY_SEPARATOR . $name);
        }
    }
    return $urls;
}

// The audio format of a file's first bytes, or null: webm (Matroska/EBML), ogg, wav, mp3, m4a.
function sign_audio_sniff($path) {
    $h = @file_get_contents($path, false, null, 0, 16);
    if (!is_string($h) || strlen($h) < 12) {
        return null;
    }
    if (substr($h, 0, 4) === "\x1A\x45\xDF\xA3") return 'webm';
    if (substr($h, 0, 4) === 'OggS') return 'ogg';
    if (substr($h, 0, 4) === 'RIFF' && substr($h, 8, 4) === 'WAVE') return 'wav';
    if (substr($h, 4, 4) === 'ftyp') return 'm4a';
    if (substr($h, 0, 3) === 'ID3' || (ord($h[0]) === 0xFF && (ord($h[1]) & 0xE0) === 0xE0)) return 'mp3';
    return null;
}
