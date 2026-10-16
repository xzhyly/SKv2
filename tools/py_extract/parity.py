# tools/py_extract/parity.py
# Compares, video by video, a cache entry the page made (browser) with one tools/py_extract made
# (python) for the SAME video files, and prints a table and PASS / FAIL.
#
#   python tools/py_extract/parity.py --browser <cache folder> --python <cache folder> [--folder <video folder>]
#
# For each video found in both caches (same cache id: file name + size + modified time):
#   - hand detected: the share of frames where both found a hand, or both found none;
#   - hands count: the share of frames with the same number of hands (shown, not judged);
#   - landmark difference: the mean absolute difference of the 126 features of the system's
#     normalisation (GestureDataRecorder.recordingToFeatureRows), over the frames where both
#     found the same number of hands (shown, not judged). In a 2-hand frame the two builds of
#     MediaPipe can list the hands in the other order (it follows which hand was found first);
#     the features then hold hand 1 and hand 2 swapped. Such frames are counted ("order") and
#     compared with the hands matched; "lm as is" is the difference without matching them;
#   - reps and split points: the page's splitter (BulkRepSplit.splitReps) run with node on both
#     entries' frames; the split points are each rep's first and last frame.
# PASS when: hand detected >= 97 % over all frames; the same rep count on >= 95 % of the videos;
# and on every video with the same rep count, every split point within 2 frames.
# The normalisation and the splitter are the page's JavaScript (parity_node.mjs), never a copy.
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import skcore  # noqa: E402

HAND_MIN = 0.97
REPS_MIN = 0.95


def load_index(cache):
    """{id: meta} of every version-2 entry with its hands file."""
    out = {}
    d = os.path.join(cache, 'videos')
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        if not name.endswith('.meta.json'):
            continue
        vid = name[:-10]
        meta = skcore.read_json(os.path.join(d, name))
        if isinstance(meta, dict) and meta.get('v') == skcore.META_VERSION and os.path.isfile(os.path.join(d, vid + '.hands.json')):
            out[vid] = meta
    return out


def source_kind(meta):
    src = meta.get('source') if isinstance(meta.get('source'), str) and meta.get('source') else 'browser'
    return 'python' if src.startswith('python') else 'browser'


def run_node(node, paths):
    out = subprocess.run([node, os.path.join(HERE, 'parity_node.mjs')], input=json.dumps(paths).encode('utf-8'),
                         capture_output=True)
    if out.returncode != 0:
        raise RuntimeError('node failed: ' + out.stderr.decode('utf-8', 'replace'))
    return json.loads(out.stdout.decode('utf-8'))


def compare(b, p, tol):
    n = min(b['frames'], p['frames'])
    det = sum(1 for k in range(n) if (b['hands'][k] > 0) == (p['hands'][k] > 0))
    cnt = sum(1 for k in range(n) if b['hands'][k] == p['hands'][k])
    diffs, raw, swapped = [], [], 0
    for k in range(n):
        fb, fp = b['features'][k], p['features'][k]
        if fb is None or fp is None or b['hands'][k] != p['hands'][k]:
            continue
        d = sum(abs(x - y) for x, y in zip(fb, fp)) / len(fb)
        raw.append(d)
        if b['hands'][k] == 2:
            sw = fp[63:] + fp[:63]
            d2 = sum(abs(x - y) for x, y in zip(fb, sw)) / len(fb)
            if d2 < d:
                d = d2
                swapped += 1
        diffs.append(d)
    rb, rp = b['split']['reps'], p['split']['reps']
    worst = None
    if len(rb) == len(rp):
        worst = 0
        for x, y in zip(rb, rp):
            worst = max(worst, abs(x['startFrame'] - y['startFrame']), abs(x['endFrame'] - y['endFrame']))
    return {
        'n': n, 'det': det, 'cnt': cnt, 'lmFrames': len(diffs),
        'lm': sum(diffs) / len(diffs) if diffs else None,
        'lmRaw': sum(raw) / len(raw) if raw else None, 'swapped': swapped,
        'two': sum(1 for k in range(n) if b['hands'][k] == 2 and p['hands'][k] == 2),
        'repsB': len(rb), 'repsP': len(rp), 'okB': b['split']['ok'], 'okP': p['split']['ok'],
        'split': worst, 'splitOk': worst is not None and worst <= tol,
        'framesB': b['frames'], 'framesP': p['frames'],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description='Browser vs python cache entries of the same videos.')
    ap.add_argument('--browser', required=True, help='cache folder with the entries the page made')
    ap.add_argument('--python', required=True, help='cache folder with the entries tools/py_extract made')
    ap.add_argument('--folder', help='only the videos of this video folder (default: every video in both caches)')
    ap.add_argument('--tol-frames', type=int, default=2, help='split points must be within this many frames (default 2)')
    ap.add_argument('--node', default=shutil.which('node'), help='node executable')
    args = ap.parse_args(argv)
    if not args.node:
        print('node was not found: install it or pass --node <path to node.exe>.')
        return 2

    ib, ip = load_index(args.browser), load_index(args.python)
    want = None
    if args.folder:
        want = {v['id']: v['relPath'] for v in skcore.scan_folder(args.folder)['videos']}
    ids = sorted((set(ib) & set(ip)) if want is None else (set(ib) & set(ip) & set(want)),
                 key=lambda i: (ib[i]['file']['name'], ib[i]['file'].get('relPath', '')))

    # same file, different cache id: the identity (name|size|lastModified) did not match
    by_file = {}
    for vid, m in ip.items():
        by_file.setdefault((m['file']['name'], m['file']['size']), []).append(m)
    for vid, m in ib.items():
        if vid in ip:
            continue
        for o in by_file.get((m['file']['name'], m['file']['size']), []):
            print('ID MISMATCH  %s: browser lastModified %s, python %s (difference %s ms)'
                  % (m['file']['name'], m['file']['lastModified'], o['file']['lastModified'],
                     o['file']['lastModified'] - m['file']['lastModified']))
    if want is not None:
        for vid, rel in sorted(want.items(), key=lambda t: t[1]):
            if vid not in ib or vid not in ip:
                print('NOT IN BOTH  %s (browser cache: %s, python cache: %s)' % (rel, 'yes' if vid in ib else 'no', 'yes' if vid in ip else 'no'))
    for vid in ids:
        if source_kind(ib[vid]) != 'browser' or source_kind(ip[vid]) != 'python':
            print('NOTE  %s: browser side source "%s", python side source "%s"'
                  % (ib[vid]['file']['name'], ib[vid].get('source', 'browser'), ip[vid].get('source', 'browser')))
    if not ids:
        print('No video is in both caches: nothing to compare.')
        return 2

    paths = []
    for vid in ids:
        paths.append(os.path.join(args.browser, 'videos', vid + '.hands.json'))
        paths.append(os.path.join(args.python, 'videos', vid + '.hands.json'))
    res = run_node(args.node, paths)

    rows = []
    for i, vid in enumerate(ids):
        c = compare(res[2 * i], res[2 * i + 1], args.tol_frames)
        c['name'] = ib[vid]['file'].get('relPath') or ib[vid]['file']['name']
        c['msB'] = (ib[vid].get('hands') or {}).get('ms')
        c['msP'] = (ip[vid].get('hands') or {}).get('ms')
        c['durMs'] = (ib[vid].get('hands') or {}).get('durationMs')
        rows.append(c)

    w = max(len('video'), max(len(r['name']) for r in rows))
    head = '%-*s  %9s  %8s  %8s  %8s  %7s  %7s  %9s  %s' % (w, 'video', 'frames', 'hand det', 'hands n', 'lm diff', 'order', 'reps', 'split max', 'result')
    print(head)
    print('-' * len(head))
    for r in rows:
        frames = str(r['framesB']) if r['framesB'] == r['framesP'] else '%d/%d' % (r['framesB'], r['framesP'])
        reps = '%d%s/%d%s' % (r['repsB'], '' if r['okB'] else '?', r['repsP'], '' if r['okP'] else '?')
        bad = []
        if r['n'] and r['det'] / r['n'] < HAND_MIN:
            bad.append('hands')
        if r['repsB'] != r['repsP']:
            bad.append('reps')
        elif not r['splitOk']:
            bad.append('split')
        print('%-*s  %9s  %7.1f%%  %7.1f%%  %8s  %7s  %7s  %9s  %s' % (
            w, r['name'], frames, 100 * r['det'] / r['n'] if r['n'] else 0, 100 * r['cnt'] / r['n'] if r['n'] else 0,
            '%.4f' % r['lm'] if r['lm'] is not None else '—', '%d/%d' % (r['swapped'], r['two']) if r['two'] else '—', reps,
            str(r['split']) if r['split'] is not None else '—', 'ok' if not bad else 'DIFF ' + ','.join(bad)))

    n = sum(r['n'] for r in rows)
    det = sum(r['det'] for r in rows) / n if n else 0
    cnt = sum(r['cnt'] for r in rows) / n if n else 0
    lm_n = sum(r['lmFrames'] for r in rows)
    lm = sum((r['lm'] or 0) * r['lmFrames'] for r in rows) / lm_n if lm_n else None
    lm_raw = sum((r['lmRaw'] or 0) * r['lmFrames'] for r in rows) / lm_n if lm_n else None
    two = sum(r['two'] for r in rows)
    swapped = sum(r['swapped'] for r in rows)
    same = [r for r in rows if r['repsB'] == r['repsP']]
    reps = len(same) / len(rows)
    split_bad = [r for r in same if not r['splitOk']]
    frame_diff = [r for r in rows if r['framesB'] != r['framesP']]
    print()
    print('Videos compared: %d; frames compared: %d%s.' % (len(rows), n,
          ('; %d videos with a different frame count (compared over the shorter)' % len(frame_diff)) if frame_diff else ''))
    print('Hand detected agreement:  %.2f %%   (need >= %.0f %%)  %s' % (100 * det, 100 * HAND_MIN, 'ok' if det >= HAND_MIN else 'FAIL'))
    print('Hands count agreement:    %.2f %%   (shown only)' % (100 * cnt))
    print('Mean landmark difference: %s   over %d frames with the same hands count, after the system normalisation, hands matched (shown only)'
          % ('%.5f' % lm if lm is not None else '—', lm_n))
    print('  ... as is (hand order as stored): %s; 2-hand frames with the hands in the other order: %d of %d (shown only)'
          % ('%.5f' % lm_raw if lm_raw is not None else '—', swapped, two))
    print('Same rep count:           %.1f %%   (%d of %d videos; need >= %.0f %%)  %s'
          % (100 * reps, len(same), len(rows), 100 * REPS_MIN, 'ok' if reps >= REPS_MIN else 'FAIL'))
    print('Split points within %d frames: %d of %d videos with the same rep count  %s'
          % (args.tol_frames, len(same) - len(split_bad), len(same), 'ok' if not split_bad else 'FAIL'))
    tb = [(r['msB'], r['durMs']) for r in rows if r['msB'] and r['durMs']]
    tp = [(r['msP'], r['durMs']) for r in rows if r['msP'] and r['durMs']]
    if tb and tp:
        print('Work per second of video (one video at a time, from meta.hands.ms): browser %.2f s, python %.2f s per worker'
              % (sum(a for a, _ in tb) / sum(b for _, b in tb), sum(a for a, _ in tp) / sum(b for _, b in tp)))
    ok = det >= HAND_MIN and reps >= REPS_MIN and not split_bad
    print()
    print('PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
