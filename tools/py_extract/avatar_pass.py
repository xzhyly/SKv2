# tools/py_extract/avatar_pass.py
# The avatar pass of extract.py (--avatar-signers): for each video of an avatar signer, MediaPipe
# Holistic on the best repetition's window only, written as the page's own avatar candidate
# (bulk_import_cache/candidates/<key>/<SIGNER>.json + .info.json, and meta.candidate), so Step 5
# Apply, the avatar-clips.html candidate picker and "Use this" read it unchanged.
#
# Only the Holistic pass itself is Python. Everything around it is the page's own JavaScript, run
# with node (avatar_node.mjs): the split (BulkRepSplit.splitReps) and the meta with the best rep
# (BulkImportCore.buildMeta / pickBestRep) when a video was not split yet, and the frame packing,
# auto-trim and clip (AvatarClip.packFrame, BulkImportCore.buildCandidate, validateClip).
# The settings of js/avatar-extract.js are matched below; docs/reports/2026-10-17-py-avatar.md
# lists each one. saved_gestures is never touched: only Step 5 Apply or "Use this" writes avatar.json.
import copy
import datetime
import json
import multiprocessing as mp_proc
import os
import re
import shutil
import subprocess
import time
import traceback

import skcore

HERE = os.path.dirname(os.path.abspath(__file__))
AVATAR_NODE = os.path.join(HERE, 'avatar_node.mjs')

# js/avatar-extract.js init(): holistic.setOptions({modelComplexity: 1, smoothLandmarks: true,
# enableSegmentation: false, refineFaceLandmarks: false, minDetectionConfidence: 0.5,
# minTrackingConfidence: 0.5}), video mode (selfieMode not set: the picture is not mirrored).
HOLISTIC_OPTIONS = dict(static_image_mode=False, model_complexity=1, smooth_landmarks=True,
                        enable_segmentation=False, refine_face_landmarks=False,
                        min_detection_confidence=0.5, min_tracking_confidence=0.5)
AVATAR_FPS = 25           # js/avatar-extract.js FPS
MAX_SIDE = 720            # ... MAX_SIDE: the canvas sent to Holistic, long side at most 720 px
MAX_CANDIDATE_MS = 60000  # js/bulk-import-ui.js MAX_CANDIDATE_MS (avatar-extract.js MAX_SECONDS 60)
TOO_LONG = 'video longer than 60 s'           # js/bulk-import-ui.js TOO_LONG
NO_REP = 'no repetition found'                # ... candidateStep()
PTS_SLACK_MS = 0.001      # as extract.py: a frame is "at" grid time t when its timestamp is <= t
RETRIEVE_MARGIN_MS = 1000  # frames this long before the window are decoded but not converted
SIGNER_RE = re.compile(r'P(0[1-9]|[1-9][0-9])\Z')
DEVICE_RE = re.compile(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])\Z')   # bulk_import.php BULK_DEVICE_RE


def now_iso_ms():
    """new Date().toISOString(): UTC, milliseconds, Z."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def now_php():
    """gmdate('c') of bulk_import.php put_candidate: the candidate's savedAt."""
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')


def valid_key(key):
    """valid_key() of php/api/bulk_import.php: a candidate folder the page could write too."""
    return isinstance(key, str) and key != '' and len(key) <= 100 and skcore.clean_label(key) == key \
        and DEVICE_RE.match(key) is None


def parse_signers(text):
    """'P03,p01' -> ['P03', 'P01'] (upper case, no repeats), or raises ValueError."""
    out = []
    for s in (text or '').split(','):
        s = s.strip().upper()
        if not s:
            continue
        if not SIGNER_RE.match(s):
            raise ValueError('not a signer id (P01..P99): %s' % s)
        if s not in out:
            out.append(s)
    return out


# ---------------------------------------------------------------- node (the page's own code)
def node_path():
    return shutil.which('node')


def run_node(requests):
    """avatar_node.mjs on a list of requests -> the list of answers."""
    node = node_path()
    if not node:
        raise RuntimeError('node is not on the PATH (the avatar pass runs the page\'s own JavaScript with node)')
    p = subprocess.run([node, AVATAR_NODE], input=json.dumps(requests, allow_nan=False).encode('utf-8'),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=HERE)
    if p.returncode != 0:
        raise RuntimeError('avatar_node.mjs failed: %s' % p.stderr.decode('utf-8', 'replace').strip()[-500:])
    return json.loads(p.stdout.decode('utf-8'))


# ---------------------------------------------------------------- the cache's candidate files
def candidate_paths(cache_dir, key, signer):
    d = os.path.join(cache_dir, 'candidates', key)
    return os.path.join(d, signer + '.json'), os.path.join(d, signer + '.info.json')


def write_candidate(cache_dir, key, signer, set_, video_id, rep_index, clip, source, frame_ms=None):
    """put_candidate of php/api/bulk_import.php, on disk: the clip file first, then its summary
    (a listed candidate always has its clip file). Same fields, plus source and frameMs (the frame
    spacing Holistic's smoothing saw, --avatar-frame-ms)."""
    saved_at = now_php()
    clip_p, info_p = candidate_paths(cache_dir, key, signer)
    skcore.write_atomic(clip_p, {'videoId': video_id, 'repIndex': rep_index, 'savedAt': saved_at, 'set': set_,
                                 'clip': clip, 'source': source, 'frameMs': frame_ms})
    skcore.write_atomic(info_p, {'signer': signer, 'set': set_, 'frames': len(clip['frames']), 'videoId': video_id,
                                 'repIndex': rep_index, 'savedAt': saved_at, 'source': source, 'frameMs': frame_ms})
    return saved_at


def candidate_owner(cache_dir, key, signer):
    """The stored candidate of a sign and signer: {videoId, source} (source 'browser' when the file
    does not name one: the page made it), or None."""
    clip_p, info_p = candidate_paths(cache_dir, key, signer)
    if not os.path.isfile(clip_p):
        return None
    info = skcore.read_json(info_p) if os.path.isfile(info_p) else None
    info = info if isinstance(info, dict) else {}
    src = info.get('source') if isinstance(info.get('source'), str) and info.get('source') else 'browser'
    return {'videoId': info.get('videoId'), 'source': src}


# ---------------------------------------------------------------- the Holistic pass of one window
class HolisticExtractor:
    """One per worker process: one MediaPipe Holistic, reset before every video (as avatar-extract.js
    extract(): holistic.reset() before the frames loop)."""

    def __init__(self, frame_us):
        import cv2
        import numpy as np
        import mediapipe as mp
        self.cv2, self.np = cv2, np
        self.holistic = mp.solutions.holistic.Holistic(**HOLISTIC_OPTIONS)
        self.frame_us = frame_us
        self.clock = 0            # packet timestamps (us) only ever grow, across videos too

    def picture(self, frame, cw, ch):
        """The canvas of extract(): the whole frame drawn into cw x ch (drawImage, bilinear sampling
        of pixel centres, as extract.py's Hands picture), RGB."""
        cv2, np = self.cv2, self.np
        h, w = frame.shape[:2]
        if (w, h) != (cw, ch):
            sx, sy = cw / w, ch / h
            m = np.float64([[sx, 0, 0.5 * sx - 0.5], [0, sy, 0.5 * sy - 0.5]])
            frame = cv2.warpAffine(frame, m, (cw, ch), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    def detect(self, rgb, k):
        """Holistic on one picture, at the clip time of grid frame k (k x 40 ms by default). The
        browser's send() stamps a frame with the wall clock when it is sent; here it is the frame's
        own time in the clip (SolutionBase.process() adds 33333 us to _simulated_timestamp first)."""
        ts = self.base + k * self.frame_us
        self.holistic._simulated_timestamp = ts - 33333
        rgb.flags.writeable = False
        r = self.holistic.process(rgb)

        def pts(lms, vis):
            if lms is None:
                return None
            if vis:
                return [[p.x, p.y, p.z, p.visibility] for p in lms.landmark]
            return [[p.x, p.y, p.z] for p in lms.landmark]
        return [pts(r.pose_landmarks, True), pts(r.left_hand_landmarks, False), pts(r.right_hand_landmarks, False)]

    def run(self, path, start_ms, end_ms, duration, margin_ms=RETRIEVE_MARGIN_MS):
        """extract(file, {range: {startMs, endMs}}) of js/avatar-extract.js: the 25 fps grid of
        seekTimes(duration, 25) (last time clamped inside the video), only the grid times k/25 with
        startMs <= k*1000/25 <= endMs. -> {frames (raw, avatar_node.mjs 'candidate'), fps, video:{w,
        h, durationMs}, firstFrame}."""
        cv2 = self.cv2
        times = skcore.seek_times(duration, AVATAR_FPS)
        if times and times[-1] >= duration:
            times[-1] = max(0, duration - 0.001)
        first, end = 0, len(times)
        while first < end and first * 1000 / AVATAR_FPS < start_ms:
            first += 1
        while end > first and (end - 1) * 1000 / AVATAR_FPS > end_ms:
            end -= 1
        cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            raise RuntimeError('OpenCV could not open the video')
        try:
            cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)     # as a browser shows a rotated phone video
        except Exception:
            pass
        self.holistic.reset()
        self.base = self.clock + 1000000                  # a new run: one second after the last packet
        frames = []
        size = None                                       # (w, h) of the video, (cw, ch) of the canvas
        cur = None                                        # the frame on screen: BGR image, or False when not converted
        k = first
        rate = cap.get(cv2.CAP_PROP_FPS) or 30
        last_pts = None
        t_first = times[first] * 1000 if first < end else 0

        def emit(img):
            nonlocal k
            if img is False:
                raise _NeedAllFrames()
            frames.append(self.detect(self.picture(img, size[2], size[3]), k))
            k += 1

        try:
            # read until every grid time of the window has its frame (and the first frame, for the
            # size, even when the window holds no grid time)
            while k < end or size is None:
                if not cap.grab():
                    break
                pts = cap.get(cv2.CAP_PROP_POS_MSEC)
                if last_pts is not None and pts <= last_pts:   # no usable timestamp: one frame on
                    pts = last_pts + 1000 / rate
                last_pts = pts
                # every grid time before this frame's time shows the frame before it
                while cur is not None and k < end and pts > times[k] * 1000 + PTS_SLACK_MS:
                    emit(cur)
                if k >= end and size is not None:
                    break
                if margin_ms is not None and size is not None and pts < t_first - margin_ms:
                    cur = False                            # long before the window: not converted
                    continue
                ok, img = cap.retrieve()
                if not ok:
                    continue
                if size is None:
                    vw, vh = img.shape[1], img.shape[0]
                    sc = min(1, MAX_SIDE / max(vw, vh))
                    size = (vw, vh, skcore.js_round(vw * sc), skcore.js_round(vh * sc))
                cur = img
            if size is None:
                raise RuntimeError('no video frame could be decoded')
            while k < end:                                 # grid times past the last frame: the last frame
                emit(cur)
        finally:
            cap.release()
        self.clock = self.base + max(k, 0) * self.frame_us
        return {'frames': frames, 'fps': AVATAR_FPS,
                'video': {'w': size[0], 'h': size[1], 'durationMs': skcore.js_round(duration * 1000)},
                'firstFrame': first if frames else None}


class _NeedAllFrames(Exception):
    """A frame skipped as too early turned out to be on screen in the window (a gap of more than
    RETRIEVE_MARGIN_MS in the video): the window is read again, converting every frame."""


_worker = None


def _init_worker(frame_us):
    global _worker
    os.environ.setdefault('GLOG_minloglevel', '2')
    _worker = HolisticExtractor(frame_us)


def video_duration(path, meta):
    """The duration the browser reports (extract.py container_duration()), else the Hands pass's."""
    from extract import container_duration
    d, _ = container_duration(path)
    return d if d else meta['hands']['durationMs'] / 1000


def none_candidate(signer, reason, rep_index, ms, source):
    """candidateStep()'s none(): the video gave up on its clip (the next file of the pair may try)."""
    return {'state': 'none', 'reason': reason, 'signer': signer, 'frames': 0, 'repIndex': rep_index,
            'ms': skcore.js_round(ms), 'source': source}


def write_meta_candidate(cache_dir, meta, cand):
    """The meta-only put_video after the candidate step: the same meta with candidate set."""
    nxt = copy.deepcopy(meta)
    nxt['candidate'] = cand
    meta_p, _ = skcore.cache_paths(cache_dir, meta['id'])
    skcore.write_atomic(meta_p, nxt)
    return nxt


def _work(job):
    """One video in a worker: Holistic on the best rep's window, the clip through the page's code,
    then the candidate files and the meta. -> a result dict for the progress line."""
    row, meta, cache_dir, source = job['row'], job['meta'], job['cache'], job['source']
    signer, key, best = row['parsed']['signer'], row['parsed']['key'], meta['bestRep']
    t0 = time.perf_counter()
    try:
        duration = video_duration(row['path'], meta)
        try:
            res = _worker.run(row['path'], best['windowStartMs'], best['windowEndMs'], duration)
        except _NeedAllFrames:
            res = _worker.run(row['path'], best['windowStartMs'], best['windowEndMs'], duration, margin_ms=None)
        holistic_ms = (time.perf_counter() - t0) * 1000
        built = run_node([{'op': 'candidate', 'key': key, 'signer': signer, 'holistic': res,
                           'createdAt': now_iso_ms(), 'source': source}])[0]
        ms = (time.perf_counter() - t0) * 1000
        if not built.get('ok'):
            write_meta_candidate(cache_dir, meta, none_candidate(signer, built.get('reason') or 'no clip', best['index'], ms, source))
            return {'id': row['id'], 'ok': True, 'made': False, 'reason': built.get('reason'), 'ms': ms,
                    'holisticFrames': len(res['frames']), 'windowMs': best['windowEndMs'] - best['windowStartMs']}
        clip = built['clip']
        frame_ms = _worker.frame_us / 1000
        write_candidate(cache_dir, key, signer, row['parsed']['set'], row['id'], best['index'], clip, source, frame_ms)
        write_meta_candidate(cache_dir, meta, {'state': 'ok', 'signer': signer, 'frames': len(clip['frames']),
                                               'repIndex': best['index'], 'ms': skcore.js_round(ms), 'source': source,
                                               'frameMs': frame_ms})
        return {'id': row['id'], 'ok': True, 'made': True, 'frames': len(clip['frames']), 'ms': ms,
                'holisticMs': holistic_ms, 'holisticFrames': len(res['frames']),
                'windowMs': best['windowEndMs'] - best['windowStartMs']}
    except Exception as e:  # one bad video never stops the run
        return {'id': row['id'], 'ok': False, 'ms': (time.perf_counter() - t0) * 1000,
                'error': '%s: %s' % (type(e).__name__, e), 'trace': traceback.format_exc()}


# ---------------------------------------------------------------- the run
def plan(videos, cache_dir, signers, overwrite, split_version):
    """-> {rows: [row of an avatar signer, scan order], pairs: [[row, ...] per sign and signer],
    needSplit: [row], missing: [row]} with row['_meta'] = its cached meta (or None)."""
    rows = [r for r in videos if r['parsed']['signer'] in signers]
    pairs, by_pair, need_split, missing = [], {}, [], []
    for r in rows:
        st, meta = skcore.cache_state(cache_dir, r['id'])
        r['_meta'] = meta if st == 'cached' else None
        if r['_meta'] is None:
            missing.append(r)
        elif not isinstance(meta.get('split'), dict) or meta['split'].get('version') != split_version:
            need_split.append(r)
        p = (r['parsed']['key'], r['parsed']['signer'])
        if p not in by_pair:
            by_pair[p] = []
            pairs.append(by_pair[p])
        by_pair[p].append(r)
    return {'rows': rows, 'pairs': pairs, 'needSplit': need_split, 'missing': missing}


def page_row(r):
    """The page's row fields that buildMeta() reads."""
    return {k: r[k] for k in ('id', 'name', 'size', 'lastModified', 'relPath', 'parsed')}


def split_from_cache(rows, cache_dir):
    """The page's 'split from the cache' for videos the Hands pass left unsplit (or split with
    older thresholds): BulkImportCore.buildMeta() through node, written as the page's put_video
    (meta only). -> [(row, error)] of the videos that could not be split."""
    if not rows:
        return []
    reqs = []
    for r in rows:
        _, hands_p = skcore.cache_paths(cache_dir, r['id'])
        reqs.append({'op': 'split', 'handsPath': hands_p, 'meta': r['_meta'], 'row': page_row(r), 'nowIso': now_iso_ms()})
    failed = []
    for r, ans in zip(rows, run_node(reqs)):
        if not ans.get('ok'):
            failed.append((r, ans.get('reason') or 'split failed'))
            r['_meta'] = None
            continue
        meta_p, _ = skcore.cache_paths(cache_dir, r['id'])
        skcore.write_atomic(meta_p, ans['meta'])
        r['_meta'] = ans['meta']
    return failed


def run(args, videos, versions_info, fmt_time):
    """The avatar pass of extract.py. -> exit code part: number of failed videos."""
    signers = args.avatar_signers
    cache_dir = args.cache
    if not node_path():
        print('Avatar pass: node is not on the PATH. It runs the page\'s own split and clip code with node; '
              'install Node.js or add it to the PATH, then run again.')
        return 1
    info = run_node([{'op': 'info'}])[0]
    p = plan(videos, cache_dir, signers, args.overwrite, info['splitVersion'])
    source = 'python mediapipe %s holistic' % versions_info['mediapipe']
    print('Avatar pass (%s) for %s: %d videos of these signers, %d without a Hands entry, %d to split from the cache first.'
          % (source, ','.join(signers), len(p['rows']), len(p['missing']), len(p['needSplit'])))
    if args.list:
        stored = sum(1 for pair in p['pairs'] if candidate_owner(cache_dir, pair[0]['parsed']['key'], pair[0]['parsed']['signer']))
        todo = sum(1 for pair in p['pairs'] if next_in_pair(pair, cache_dir, args.overwrite, {}))
        print('  %d signs of these signers; %d already have a candidate%s; %d would get one now (the split first where needed).'
              % (len(p['pairs']), stored, ' (made again: --overwrite)' if args.overwrite else '', todo))
        return 0

    failed_split = split_from_cache(p['needSplit'], cache_dir)
    done_ids = {}                    # id -> 'ok' | 'none' | 'failed' (this run)
    failures = []
    for r, why in failed_split:
        done_ids[r['id']] = 'failed'
        failures.append((r, 'split: ' + why))
    for r in p['missing']:
        done_ids[r['id']] = 'failed'

    skipped = {'browser': 0, 'python': 0, 'none-before': 0}
    if not args.overwrite:
        for pair in p['pairs']:
            owner = candidate_owner(cache_dir, pair[0]['parsed']['key'], pair[0]['parsed']['signer'])
            if owner is not None:
                skipped['python' if owner['source'].startswith('python') else 'browser'] += 1
            else:
                skipped['none-before'] += sum(1 for r in pair if isinstance(r['_meta'], dict)
                                              and isinstance(r['_meta'].get('candidate'), dict)
                                              and r['_meta']['candidate'].get('state') == 'none')
    made = nones = 0
    none_reasons = {}
    t0 = time.perf_counter()
    count = 0
    ctx = mp_proc.get_context('spawn')
    pool = None
    limit = args.limit if args.limit > 0 else None
    try:
        while limit is None or count < limit:
            jobs, refused = [], 0
            for pair in p['pairs']:
                r = next_in_pair(pair, cache_dir, args.overwrite, done_ids)
                if r is None:
                    continue
                meta, best = r['_meta'], r['_meta'].get('bestRep')
                key, signer = r['parsed']['key'], r['parsed']['signer']
                # candidateStep()'s refusals, before any Holistic work
                why = None
                if not valid_key(key):
                    why = 'Invalid key'
                elif not best:
                    why = NO_REP
                elif meta['hands']['durationMs'] >= MAX_CANDIDATE_MS:
                    why = TOO_LONG
                if why:
                    r['_meta'] = write_meta_candidate(cache_dir, meta, none_candidate(signer, why, best['index'] if best else None, 0, source))
                    done_ids[r['id']] = 'none'
                    nones += 1
                    refused += 1
                    none_reasons[why] = none_reasons.get(why, 0) + 1
                    print('  no clip  %s  — %s' % (r['relPath'], why))
                    continue
                jobs.append(r)
            if limit is not None:
                jobs = jobs[:limit - count]
            if not jobs:
                if refused:
                    continue          # a later file of those pairs may try
                break
            if pool is None:
                workers = max(1, min(args.workers, len(jobs)))
                print('Avatar pass: %d video%s to run Holistic on; %d worker%s.' % (len(jobs), '' if len(jobs) == 1 else 's', workers, '' if workers == 1 else 's'))
                pool = ctx.Pool(workers, initializer=_init_worker, initargs=(int(round(args.avatar_frame_ms * 1000)),))
            else:
                print('Avatar pass: %d more video%s (a later file of a sign whose first file gave no clip).' % (len(jobs), '' if len(jobs) == 1 else 's'))
            by_id = {r['id']: r for r in jobs}
            todo = [{'row': {k: v for k, v in r.items() if k != '_meta'}, 'meta': r['_meta'], 'cache': cache_dir, 'source': source} for r in jobs]
            n = 0
            for res in pool.imap_unordered(_work, todo):
                n += 1
                count += 1
                r = by_id[res['id']]
                if res['ok'] and res['made']:
                    made += 1
                    done_ids[r['id']] = 'ok'
                    state = 'clip %d frames (rep %d, %d frames read), %.1f s' % (res['frames'], r['_meta']['bestRep']['index'], res['holisticFrames'], res['ms'] / 1000)
                elif res['ok']:
                    nones += 1
                    done_ids[r['id']] = 'none'
                    none_reasons[res['reason']] = none_reasons.get(res['reason'], 0) + 1
                    state = 'no clip: %s' % res['reason']
                else:
                    done_ids[r['id']] = 'failed'
                    failures.append((r, res['error']))
                    state = 'FAILED ' + res['error']
                if res['ok']:
                    r['_meta'] = skcore.read_json(skcore.cache_paths(cache_dir, r['id'])[0]) or r['_meta']
                el = time.perf_counter() - t0
                eta = el / n * (len(jobs) - n)
                rate = count / el * 60 if el > 0 else 0
                print('[avatar %d/%d] %5.1f%%  elapsed %s  ETA %s  %.1f videos/min  %s  %s'
                      % (n, len(jobs), n * 100 / len(jobs), fmt_time(el), fmt_time(eta), rate, r['relPath'], state), flush=True)
    finally:
        if pool is not None:
            pool.close()
            pool.join()
    el = time.perf_counter() - t0
    print('Avatar pass finished: %d clips made, %d without a clip, %d failed in %s; %.1f videos per minute.'
          % (made, nones, len(failures), fmt_time(el), count / el * 60 if el > 0 and count else 0))
    if none_reasons:
        print('  without a clip: ' + '; '.join('%s: %d' % kv for kv in sorted(none_reasons.items())))
    if any(skipped.values()):
        print('  skipped (--overwrite makes them again): %d signs already had a browser candidate, %d a python candidate; '
              '%d videos gave no clip in an earlier run' % (skipped['browser'], skipped['python'], skipped['none-before']))
    for r, why in failures:
        print('  FAILED  %s  — %s' % (r['relPath'], why))
    for r in p['missing']:
        print('  NO HANDS ENTRY  %s  — run the Hands pass first (it failed or was limited)' % r['relPath'])
    return len(failures) + len(p['missing'])


def next_in_pair(pair, cache_dir, overwrite, done):
    """The video of one sign and signer that should make its candidate now, or None.
    The page's rule (mayMakeCandidate / needsCandidate): the first file in file-name order makes the
    clip; a later one only when every earlier one gave up (failed, or its candidate is 'none').
    Without --overwrite a stored candidate (browser or python) is never replaced, and a video whose
    meta already has a candidate (ok or none) is not redone. done: id -> 'ok'|'none'|'failed' of
    this run."""
    if not overwrite and candidate_owner(cache_dir, pair[0]['parsed']['key'], pair[0]['parsed']['signer']) is not None:
        return None
    for r in pair:
        st = done.get(r['id'])
        if st in ('none', 'failed'):
            continue                       # gave up: the next file may try
        if st == 'ok':
            return None
        cand = r['_meta'].get('candidate') if isinstance(r['_meta'], dict) else None
        if not overwrite and isinstance(cand, dict):
            if cand.get('state') == 'none':
                continue
            return None                    # 'ok' in its meta (its clip file was removed): as the page, no work
        return r
    return None
