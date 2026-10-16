# tools/py_extract/skcore.py
# The pure part of the Python extractor: file-name rules, the cache identity, the frame grid, the
# letterbox rectangle, JS-style rounding, the cache entry (format version 2) and its atomic write.
# Every rule here is a copy of a rule in the page's JavaScript, cited by file; test_skcore.py runs
# the same inputs through node and the real JS files and checks the answers are identical.
# No MediaPipe, no OpenCV: this module imports nothing outside the standard library.
import hashlib
import json
import math
import os
import re

# ---------------------------------------------------------------- file names
# js/bulk-import-core.js: VIDEO_EXT, NAME_RE, cleanLabel(), parseName().
VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp']
BAD_NAME = 'bad file name'
# JS "." matches anything but a line terminator; JS "$" (no m flag) is only the very end; JS /i
# without the u flag folds ASCII letters only (re.A keeps Python from folding e.g. the Kelvin sign).
_ANY = '[^\n\r  ]'
NAME_RE = re.compile(r'(ESL|FSL|BOTH)_(' + _ANY + r'+)_(P(?:0[1-9]|[1-9][0-9]))\.([a-z0-9]+)\Z', re.I | re.A)
# js/bulk-import-ui.js JUNK_RE: files a folder holds without anyone putting them there.
JUNK_RE = re.compile(r'(desktop\.ini|thumbs\.db|ehthumbs\.db|\.ds_store|\.' + _ANY + r'*|~\$' + _ANY + r'*)\Z', re.I | re.A)
# The characters JS String.prototype.trim() and the regex \s treat as white space.
_JS_WS = '\t\n\v\f\r                  　﻿'
_JS_WS_RUN = re.compile('[' + _JS_WS + ']+')


def clean_label(s):
    """cleanLabel() of js/bulk-import-core.js (= js/gesture-data.js, php clean_label())."""
    s = str(s or '').strip(_JS_WS).lower()
    s = _JS_WS_RUN.sub('_', s)
    s = re.sub(r'[^a-z0-9_-]', '', s)
    return re.sub(r'^[_-]+|[_-]+$', '', s)


def parse_name(file_name):
    """parseName() of js/bulk-import-core.js. Never guesses: anything else is a bad file name."""
    m = NAME_RE.match(str(file_name or ''))
    if not m:
        return {'ok': False, 'reason': BAD_NAME}
    ext = m.group(4).lower()
    key = clean_label(m.group(2))
    if ext not in VIDEO_EXT or not key:
        return {'ok': False, 'reason': BAD_NAME}
    return {'ok': True, 'set': m.group(1).upper(), 'label': m.group(2), 'key': key,
            'signer': m.group(3).upper(), 'ext': ext}


def is_junk(file_name):
    return JUNK_RE.match(file_name) is not None


def skip_folder(rel_path):
    """skipFolder() of js/bulk-import-core.js: a file below a sub-folder named "unzipping" or
    "_duplicates..." (any case) is not a video of the dataset. rel_path: "<chosen folder>/.../<name>"
    with "/" separators; the chosen folder itself and the file name are not looked at."""
    parts = str(rel_path).split('/')
    for d in parts[1:-1]:
        low = d.lower()
        if low == 'unzipping' or low.startswith('_duplicates'):
            return True
    return False


# ---------------------------------------------------------------- cache identity
def last_modified_ms(st):
    """File.lastModified of the browser: whole milliseconds since 1970, rounded down."""
    return st.st_mtime_ns // 1000000


def video_id_source(name, size, last_modified):
    """videoIdSource() of js/bulk-import-core.js."""
    return '%s|%d|%d' % (name, size, last_modified)


def sha32(text):
    """sha32() of js/bulk-import-ui.js: the first 32 hex characters of SHA-256 of the UTF-8 text."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:32]


# ---------------------------------------------------------------- folder scan
def scan_folder(root):
    """The folder rules of setFolder() (js/bulk-import-ui.js) for a folder on disk.
    -> {name, files, ignored, skipped, videos:[row], problems:[{name, relPath, reason}]}, videos in
    the page's queue order (file name, then relative path); a second copy of the same file (same
    name, size and modified time = same cache id) is a problem, the first one is kept."""
    root = os.path.abspath(root)
    top = os.path.basename(root.rstrip('\\/')) or root
    rows, problems = [], []
    files = ignored = skipped = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fname in sorted(filenames):
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root).replace(os.sep, '/')
            rel_path = top + '/' + rel
            files += 1
            if skip_folder(rel_path):
                skipped += 1
                continue
            parsed = parse_name(fname)
            if not parsed['ok']:
                if is_junk(fname):
                    ignored += 1
                else:
                    problems.append({'name': fname, 'relPath': rel_path, 'reason': parsed['reason']})
                continue
            st = os.stat(full)
            lm = last_modified_ms(st)
            rows.append({'path': full, 'name': fname, 'relPath': rel_path, 'size': st.st_size,
                         'lastModified': lm, 'parsed': parsed,
                         'id': sha32(video_id_source(fname, st.st_size, lm))})
    key = lambda r: (js_sort_key(r['name']), js_sort_key(r['relPath']))
    rows.sort(key=key)
    seen, videos = {}, []
    for r in rows:
        if r['id'] in seen:
            problems.append({'name': r['name'], 'relPath': r['relPath'], 'reason': 'same file as ' + seen[r['id']]})
            continue
        seen[r['id']] = r['relPath']
        videos.append(r)
    problems.sort(key=key)
    return {'name': top, 'files': files, 'ignored': ignored, 'skipped': skipped,
            'videos': videos, 'problems': problems}


def js_sort_key(s):
    """JS compares strings by UTF-16 code units; Python by code points. Same order except for
    characters above U+FFFF, which this key handles too."""
    return s.encode('utf-16-be')


# ---------------------------------------------------------------- frame grid and input picture
PROCESS_FPS = 15        # GestureCaptureCore.CAPTURE.PROCESS_FPS (js/capture-core.js)
INPUT_W = 320           # extractVideoLandmarks() inputWidth default (js/video-landmarks.js)
INPUT_H = 240           # ... inputHeight default


def js_round(x):
    """JS Math.round: the nearest whole number, halves up. (Not floor(x + 0.5): that is 1 for
    0.49999999999999994, where Math.round gives 0.)"""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def round_dp(n, dp):
    """round() of js/video-landmarks.js: Math.round(n * 10^dp) / 10^dp. A whole value is an int, so
    the JSON reads 0 or 1 as JSON.stringify writes it (not 0.0, and never -0)."""
    m = 10 ** dp
    return _num(js_round(n * m) / m)


def seek_times(duration, fps):
    """seekTimes() of js/video-landmarks.js: k / fps for k in [0, ceil(duration * fps))."""
    total = math.ceil(duration * fps)
    return [k / fps for k in range(total)]


def letterbox_rect(src_w, src_h, dst_w, dst_h):
    """letterboxRect() of js/gesture-data.js."""
    src_ratio = src_w / src_h
    dst_ratio = dst_w / dst_h
    w, h, x, y = dst_w, dst_h, 0, 0
    if src_ratio > dst_ratio:
        h = dst_w / src_ratio
        y = (dst_h - h) / 2
    else:
        w = dst_h * src_ratio
        x = (dst_w - w) / 2
    return {'x': _num(x), 'y': _num(y), 'w': _num(w), 'h': _num(h)}


def _num(v):
    """A whole float as an int, so the JSON reads 30 (as JSON.stringify writes it), not 30.0."""
    return int(v) if isinstance(v, float) and v.is_integer() else v


# ---------------------------------------------------------------- cache entry (format version 2)
META_VERSION = 2        # BulkImportCore.META_VERSION (js/bulk-import-core.js)


def carry_over(old):
    """What a new extraction keeps from the meta a video had before, exactly as buildMeta() of
    js/bulk-import-ui.js does: imported (the importIds Import saved), legacyReps (the reps a
    version-1 import saved), the avatar candidate when the old split was the 3 clear reps, and
    savedAt of a version-2 meta. seg is kept too: it is the field buildMeta() reads to keep the
    candidate when the page later splits this entry (split is null until then)."""
    if not isinstance(old, dict):
        return {'imported': [], 'legacyReps': None, 'candidate': None, 'seg': None, 'savedAt': None}
    legacy = None
    if old.get('v') != META_VERSION and isinstance(old.get('reps'), list):
        legacy = [{'index': r.get('index'), 'startMs': r.get('startMs'), 'endMs': r.get('endMs')} for r in old['reps']]
    elif isinstance(old.get('legacyReps'), list):
        legacy = old['legacyReps']
    seg = old.get('seg') if isinstance(old.get('seg'), dict) else None
    cand = old.get('candidate') if isinstance(old.get('candidate'), dict) else None
    keep = bool(seg and seg.get('ok') and cand and cand.get('state') == 'ok')
    return {
        'imported': list(old['imported']) if isinstance(old.get('imported'), list) else [],
        'legacyReps': legacy,
        'candidate': cand if keep else None,
        'seg': seg if keep else None,
        'savedAt': old.get('savedAt') if old.get('v') == META_VERSION else None,
    }


def build_entry(row, result, ms, source, extractor, old, saved_at):
    """-> (meta, hands): the two cache files of one video. result: {videoWidth, videoHeight, fps,
    durationMs, input, frames}. split is null and reps empty: the page splits the entry from these
    frames on its next Start (BulkImportCore.cacheState() -> 'resplit'), with its own splitter."""
    keep = carry_over(old)
    frames = result['frames']
    meta = {
        'v': META_VERSION, 'id': row['id'],
        'file': {'name': row['name'], 'size': row['size'], 'lastModified': row['lastModified'], 'relPath': row['relPath']},
        'parsed': {k: row['parsed'][k] for k in ('set', 'label', 'key', 'signer')},
        'hands': {
            'videoWidth': result['videoWidth'], 'videoHeight': result['videoHeight'], 'fps': result['fps'],
            'durationMs': result['durationMs'], 'input': result['input'],
            'frameCount': len(frames),
            'handFrames': sum(1 for f in frames if f['hands']),
            'ms': js_round(ms),
        },
        'seg': keep['seg'],
        'split': None,
        'reps': [],
        'bestRep': None,
        'candidate': keep['candidate'],
        'imported': keep['imported'],
        'legacyReps': keep['legacyReps'],
        'savedAt': keep['savedAt'] or saved_at,
        'source': source,
        'extractor': extractor,
    }
    hands = {
        'id': row['id'], 'v': META_VERSION,
        'meta': {k: result[k] for k in ('videoWidth', 'videoHeight', 'fps', 'durationMs', 'input')},
        'frames': frames,
        'source': source,
    }
    return meta, hands


def dumps(value):
    """Compact UTF-8 JSON, as php/api/bulk_import.php writes it (unescaped slashes and unicode)."""
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def write_atomic(path, value):
    """write_atomic() of php/api/bulk_import.php: a temp file next to the target, then a rename."""
    data = dumps(value).encode('utf-8')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = '%s.tmp-%s' % (path, os.urandom(4).hex())
    with open(tmp, 'wb') as f:
        f.write(data)
    try:
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:      # Windows: the file is being read at this moment
                if attempt == 4:
                    raise
                import time
                time.sleep(0.05)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return len(data)


def cache_paths(cache_dir, vid):
    d = os.path.join(cache_dir, 'videos')
    return os.path.join(d, vid + '.meta.json'), os.path.join(d, vid + '.hands.json')


def read_json(path):
    try:
        with open(path, 'rb') as f:
            return json.loads(f.read().decode('utf-8'))
    except (OSError, ValueError):
        return None


def cache_state(cache_dir, vid):
    """'none' (not cached) | 'old' (a version-1 entry, or a meta without its hands file: read
    again) | 'cached' (a version-2 entry: skipped). -> (state, meta or None)."""
    meta_p, hands_p = cache_paths(cache_dir, vid)
    meta = read_json(meta_p) if os.path.isfile(meta_p) else None
    if not isinstance(meta, dict):
        return 'none', None
    if meta.get('v') != META_VERSION or not os.path.isfile(hands_p):
        return 'old', meta
    return 'cached', meta
