# tools/py_extract/extract.py
# Fast Hands pass for bulk-import.html: reads every video of a folder with OpenCV, runs MediaPipe
# Hands on the same 320x240 pictures at the same times as the page, and writes the page's own
# cache entries (bulk_import_cache/videos/<id>.meta.json + <id>.hands.json, format version 2).
# The page then shows those videos as already extracted (python) and its Start only splits them
# from the cache (no video is read) and, for the avatar signers, runs the Holistic pass on the
# best repetition. The split, Review, Import, Compile and the avatar stay in the page.
# Videos are only read. Nothing is uploaded; nothing outside the cache folder is written.
#
#   python tools/py_extract/extract.py <video folder> [--cache <cache folder>] [--workers N]
#
# README.md next to this file has the install and run commands.
import argparse
import datetime
import math
import multiprocessing as mp_proc
import os
import platform
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skcore  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DEFAULT_CACHE = os.path.join(REPO, 'bulk_import_cache')

# MediaPipe Hands, as js/gesture-data.js setupMediaPipe() sets it (hands.setOptions): the video
# stream mode (tracking between frames), at most 2 hands, the full landmark model, 0.65 / 0.65.
HANDS_OPTIONS = dict(static_image_mode=False, max_num_hands=2, model_complexity=1,
                     min_detection_confidence=0.65, min_tracking_confidence=0.65)
# A video frame is "at" grid time t when its timestamp is at most t (what a seek to t shows);
# this slack only absorbs rounding of the two times.
PTS_SLACK_MS = 0.001


# ---------------------------------------------------------------- duration
def mp4_duration(path):
    """The movie duration of an MP4 / MOV file (moov/mvhd: duration / timescale, seconds), or
    None. Chrome's video.duration for these files is the longest track, which mvhd records."""
    try:
        with open(path, 'rb') as f:
            size = os.fstat(f.fileno()).st_size

            def boxes(start, end):
                pos = start
                while pos + 8 <= end:
                    f.seek(pos)
                    head = f.read(8)
                    n = int.from_bytes(head[:4], 'big')
                    kind = head[4:8]
                    hdr = 8
                    if n == 1:
                        n = int.from_bytes(f.read(8), 'big')
                        hdr = 16
                    elif n == 0:
                        n = end - pos
                    if n < hdr:
                        return
                    yield kind, pos + hdr, pos + n
                    pos += n

            for kind, a, b in boxes(0, size):
                if kind != b'moov':
                    continue
                for kind2, c, d in boxes(a, b):
                    if kind2 != b'mvhd':
                        continue
                    f.seek(c)
                    body = f.read(32)
                    if body[0] == 1:
                        scale = int.from_bytes(body[20:24], 'big')
                        dur = int.from_bytes(body[24:32], 'big')
                    else:
                        scale = int.from_bytes(body[12:16], 'big')
                        dur = int.from_bytes(body[16:20], 'big')
                    if scale > 0 and 0 < dur < 0xFFFFFFFF:
                        return dur / scale
                    return None
    except (OSError, IndexError):
        return None
    return None


def _vint(f, keep_marker):
    """An EBML variable-size integer: (value, length) or (None, 0) at the end of the file."""
    b = f.read(1)
    if not b:
        return None, 0
    first = b[0]
    n = 1
    while n <= 8 and not first & (0x80 >> (n - 1)):
        n += 1
    if n > 8:
        return None, 0
    rest = f.read(n - 1)
    if len(rest) != n - 1:
        return None, 0
    v = first if keep_marker else first & (0xFF >> n)
    for c in rest:
        v = (v << 8) | c
    unknown = not keep_marker and v == (1 << (7 * n)) - 1
    return (-1 if unknown else v), n


def webm_duration(path):
    """Segment/Info/Duration x TimecodeScale of a WebM / Matroska file (seconds), or None: the
    duration the browser reports for these files."""
    import struct
    try:
        with open(path, 'rb') as f:
            end = os.fstat(f.fileno()).st_size
            pos = 0
            while pos < end:
                f.seek(pos)
                eid, a = _vint(f, True)
                size, b = _vint(f, False)
                if eid is None or size is None:
                    return None
                body = pos + a + b
                if eid == 0x18538067:                      # Segment: look inside
                    seg_end = end if size < 0 else min(end, body + size)
                    p2 = body
                    while p2 < seg_end:
                        f.seek(p2)
                        cid, a2 = _vint(f, True)
                        csize, b2 = _vint(f, False)
                        if cid is None or csize is None or csize < 0:
                            return None
                        cbody = p2 + a2 + b2
                        if cid == 0x1F43B675:              # a Cluster before Info: give up
                            return None
                        if cid == 0x1549A966:              # Info
                            scale, dur = 1000000, None
                            p3 = cbody
                            while p3 < cbody + csize:
                                f.seek(p3)
                                iid, a3 = _vint(f, True)
                                isize, b3 = _vint(f, False)
                                if iid is None or isize is None or isize < 0:
                                    return None
                                raw = f.read(isize)
                                if iid == 0x2AD7B1 and raw:
                                    scale = int.from_bytes(raw, 'big')
                                elif iid == 0x4489 and isize in (4, 8):
                                    dur = struct.unpack('>f' if isize == 4 else '>d', raw)[0]
                                p3 += a3 + b3 + isize
                            return dur * scale / 1e9 if dur and dur > 0 else None
                        p2 = cbody + csize
                    return None
                if size < 0:
                    return None
                pos = body + size
    except (OSError, ValueError):
        return None
    return None


MP4_EXT = ('.mp4', '.mov', '.m4v', '.3gp')
WEBM_EXT = ('.webm', '.mkv')


def container_duration(path):
    """(seconds, how) from the file's own header, or (None, None)."""
    ext = os.path.splitext(path)[1].lower()
    if ext in MP4_EXT:
        d = mp4_duration(path)
        return (d, 'mp4 mvhd') if d else (None, None)
    if ext in WEBM_EXT:
        d = webm_duration(path)
        return (d, 'webm segment info') if d else (None, None)
    return None, None


# ---------------------------------------------------------------- the Hands pass of one video
class Extractor:
    """One per worker process: one MediaPipe Hands, reset before every video (as the page's
    detector.reset() at the start of extractVideoLandmarks())."""

    def __init__(self, resample):
        import cv2
        import numpy as np
        import mediapipe as mp
        self.cv2, self.np = cv2, np
        self.hands = mp.solutions.hands.Hands(**HANDS_OPTIONS)
        self.resample = resample

    def picture(self, frame, rect, src_w, src_h):
        """The 320x240 input canvas of extractVideoLandmarks(): black, with the frame drawn into
        rect (letterboxRect) by canvas drawImage, i.e. bilinear sampling of pixel centres
        ('linear'); 'area' averages instead (an option, for testing only). RGB, as MediaPipe gets
        it from a canvas."""
        cv2, np = self.cv2, self.np
        sx, sy = rect['w'] / src_w, rect['h'] / src_h
        if self.resample == 'area':
            w, h = max(1, round(rect['w'])), max(1, round(rect['h']))
            small = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
            out = np.zeros((skcore.INPUT_H, skcore.INPUT_W, 3), np.uint8)
            x0, y0 = int(round(rect['x'])), int(round(rect['y']))
            h, w = min(h, skcore.INPUT_H - y0), min(w, skcore.INPUT_W - x0)
            out[y0:y0 + h, x0:x0 + w] = small[:h, :w]
        else:
            # destination pixel centre (xd + 0.5) maps to source (xd + 0.5 - x) / sx; OpenCV's
            # pixel centres are at whole coordinates, hence the -0.5 terms.
            m = np.float64([[sx, 0, rect['x'] + 0.5 * sx - 0.5], [0, sy, rect['y'] + 0.5 * sy - 0.5]])
            out = cv2.warpAffine(frame, m, (skcore.INPUT_W, skcore.INPUT_H), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)

    def detect(self, rgb):
        rgb.flags.writeable = False
        r = self.hands.process(rgb)
        lms = r.multi_hand_landmarks or []
        hds = r.multi_handedness or []
        hands = []
        for i, lm in enumerate(lms):
            cls = hds[i].classification[0] if i < len(hds) and hds[i].classification else None
            hands.append({
                'label': cls.label if cls else None,
                'score': skcore.round_dp(cls.score if cls else 0, 3),
                'landmarks': [{'x': skcore.round_dp(p.x, 4), 'y': skcore.round_dp(p.y, 4), 'z': skcore.round_dp(p.z, 4)}
                              for p in lm.landmark],
            })
        return hands

    def run(self, path):
        """-> the result extractVideoLandmarks() returns: {frames, videoWidth, videoHeight, fps,
        durationMs, input}, plus 'durationFrom'."""
        cv2 = self.cv2
        cap = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            raise RuntimeError('OpenCV could not open the video')
        try:
            cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)     # as a browser shows a rotated phone video
        except Exception:
            pass
        fps = skcore.PROCESS_FPS
        self.hands.reset()
        frames = []
        cur = None
        rect = src = None
        k = 0
        last_pts = prev_pts = None
        duration, how = container_duration(path)
        cap_total = math.ceil(duration * fps) if duration else None
        rate = cap.get(cv2.CAP_PROP_FPS) or 30

        def emit(img):
            nonlocal k
            frames.append({'t': skcore.js_round(k * 1000 / fps),
                           'hands': self.detect(self.picture(img, rect, src[0], src[1]))})
            k += 1

        try:
            while True:
                ok, img = cap.read()
                if not ok:
                    break
                pts = cap.get(cv2.CAP_PROP_POS_MSEC)
                if last_pts is not None and pts <= last_pts:   # no usable timestamp: one frame on
                    pts = last_pts + 1000 / rate
                if src is None:
                    src = (img.shape[1], img.shape[0])
                    rect = skcore.letterbox_rect(src[0], src[1], skcore.INPUT_W, skcore.INPUT_H)
                # every grid time before this frame's time shows the frame before it
                while cur is not None and (cap_total is None or k < cap_total) and pts > k * 1000 / fps + PTS_SLACK_MS:
                    emit(cur)
                cur = img
                prev_pts, last_pts = last_pts, pts
            if cur is None:
                raise RuntimeError('no video frame could be decoded')
            if not duration:
                # OpenCV's own estimate (the container duration, in whole frames), else the last
                # frame's time plus one frame
                n = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                if n > 0 and rate > 0 and n / rate * 1000 >= last_pts:
                    duration, how = n / rate, 'opencv frame count'
                else:
                    step = (last_pts - prev_pts) if prev_pts is not None and last_pts > prev_pts else 1000 / rate
                    duration, how = (last_pts + step) / 1000, 'decoded frames'
            total = math.ceil(duration * fps)
            while k < total:                               # the grid past the last frame: the last frame
                emit(cur)
            del frames[total:]
        finally:
            cap.release()
        return {
            'frames': frames,
            'videoWidth': src[0], 'videoHeight': src[1],
            'fps': fps,
            'durationMs': skcore.js_round(duration * 1000),
            'input': {'width': skcore.INPUT_W, 'height': skcore.INPUT_H, 'contentRect': rect},
            'durationFrom': how,
        }


_worker = None


def _init_worker(resample):
    global _worker
    os.environ.setdefault('GLOG_minloglevel', '2')
    _worker = Extractor(resample)


def _work(job):
    """One video in a worker process: extract, then write hands.json and meta.json (hands first,
    as put_video does: a listed meta always has its hands file)."""
    row, cache_dir, source, extractor_info = job['row'], job['cache'], job['source'], job['extractor']
    t0 = time.perf_counter()
    try:
        result = _worker.run(row['path'])
        ms = (time.perf_counter() - t0) * 1000
        info = dict(extractor_info, durationFrom=result.pop('durationFrom'))
        _, old = skcore.cache_state(cache_dir, row['id'])
        meta, hands = skcore.build_entry(row, result, ms, source, info, old,
                                         datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
        meta_p, hands_p = skcore.cache_paths(cache_dir, row['id'])
        skcore.write_atomic(hands_p, hands)
        skcore.write_atomic(meta_p, meta)
        return {'id': row['id'], 'ok': True, 'ms': ms, 'videoMs': result['durationMs'],
                'frames': len(result['frames']), 'handFrames': meta['hands']['handFrames']}
    except Exception as e:  # one bad video never stops the run
        return {'id': row['id'], 'ok': False, 'ms': (time.perf_counter() - t0) * 1000,
                'error': '%s: %s' % (type(e).__name__, e), 'trace': traceback.format_exc()}


# ---------------------------------------------------------------- the run
def fmt_time(s):
    s = max(0, int(round(s)))
    h, m, sec = s // 3600, s % 3600 // 60, s % 60
    return ('%d:%02d:%02d' % (h, m, sec)) if h else ('%d:%02d' % (m, sec))


def versions():
    import cv2
    import mediapipe as mp
    import numpy as np
    return {'mediapipe': mp.__version__, 'opencv': cv2.__version__, 'numpy': np.__version__,
            'python': platform.python_version()}


def main(argv=None):
    ap = argparse.ArgumentParser(description='Fill the bulk importer cache with the Hands pass of every video in a folder.')
    ap.add_argument('folder', help='the video folder (subfolders included), as chosen in bulk-import.html')
    ap.add_argument('--cache', default=DEFAULT_CACHE, help='cache folder (default: <repo>/bulk_import_cache, the one the page reads)')
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 1), help='videos at a time (default: CPU cores - 1)')
    ap.add_argument('--force', action='store_true', help='extract again videos that are already in the cache')
    ap.add_argument('--limit', type=int, default=0, help='extract at most this many videos (0: all)')
    ap.add_argument('--resample', choices=['linear', 'area'], default='linear', help=argparse.SUPPRESS)
    ap.add_argument('--list', action='store_true', help='only list the videos and the problems, extract nothing')
    args = ap.parse_args(argv)

    if not os.path.isdir(args.folder):
        print('Not a folder: %s' % args.folder)
        return 2
    scan = skcore.scan_folder(args.folder)
    videos = scan['videos']
    print('Folder %s: %d files, %d videos, %d ignored, %d in skipped folders (unzipping, _duplicates*), %d problems.'
          % (scan['name'], scan['files'], len(videos), scan['ignored'], scan['skipped'], len(scan['problems'])))
    for p in scan['problems']:
        print('  PROBLEM  %s  — %s' % (p['relPath'], p['reason']))

    todo, skipped, old = [], 0, 0
    for row in videos:
        st, _ = skcore.cache_state(args.cache, row['id'])
        if st == 'cached' and not args.force:
            skipped += 1
            continue
        if st == 'old':
            old += 1
        todo.append(row)
    if args.limit > 0:
        todo = todo[:args.limit]
    print('Cache %s: %d already extracted (skipped), %d to extract%s.'
          % (args.cache, skipped, len(todo), (' (%d of them cached by the old importer)' % old) if old else ''))
    if args.list or not todo:
        return 0

    v = versions()
    source = 'python mediapipe %s' % v['mediapipe']
    extractor = dict(v, tool='tools/py_extract/extract.py', resample=args.resample, options=HANDS_OPTIONS)
    workers = max(1, min(args.workers, len(todo)))
    print('%s, opencv %s, python %s; %d worker%s.' % (source, v['opencv'], v['python'], workers, '' if workers == 1 else 's'))

    jobs = [{'row': r, 'cache': args.cache, 'source': source, 'extractor': extractor} for r in todo]
    t0 = time.perf_counter()
    done = failed = 0
    video_ms = 0
    failures = []
    ctx = mp_proc.get_context('spawn')
    with ctx.Pool(workers, initializer=_init_worker, initargs=(args.resample,)) as pool:
        for res in pool.imap_unordered(_work, jobs):
            done += 1
            row = next(r for r in todo if r['id'] == res['id'])
            if res['ok']:
                video_ms += res['videoMs']
            else:
                failed += 1
                failures.append((row, res))
            el = time.perf_counter() - t0
            eta = el / done * (len(todo) - done)
            rate = done / el * 60 if el > 0 else 0
            state = ('ok  %d frames, %d with a hand, %.1f s' % (res['frames'], res['handFrames'], res['ms'] / 1000)) if res['ok'] else 'FAILED ' + res['error']
            print('[%d/%d] %5.1f%%  elapsed %s  ETA %s  %.1f videos/min  %s  %s'
                  % (done, len(todo), done * 100 / len(todo), fmt_time(el), fmt_time(eta), rate, row['relPath'], state), flush=True)
    el = time.perf_counter() - t0
    print('Finished: %d extracted, %d failed, %d skipped (already extracted) in %s; %.1f videos per minute; %.2f s of work per second of video.'
          % (done - failed, failed, skipped, fmt_time(el), (done - failed) / el * 60 if el else 0, el / (video_ms / 1000) if video_ms else 0))
    for row, res in failures:
        print('  FAILED  %s  — %s' % (row['relPath'], res['error']))
    print('Next: open bulk-import.html, choose the same folder, press Start on Extract (it splits the videos from the cache).')
    return 1 if failed else 0


if __name__ == '__main__':
    mp_proc.freeze_support()
    sys.exit(main())
