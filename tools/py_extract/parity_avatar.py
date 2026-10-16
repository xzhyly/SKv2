# tools/py_extract/parity_avatar.py
# Browser vs python avatar candidates of the same videos (py-avatar phase, owner decision 6).
#
#   python tools/py_extract/parity_avatar.py --browser bulk_import_cache --python <second cache>
#                                            [--signer P03] [--max-mean-sigma 0.10]
#
# Pairs every python candidate (candidates/<key>/<SIGNER>.json whose source is python) with the
# browser candidate of the same sign and signer, and measures both with the page's own avatar code
# (parity_avatar_node.mjs, through node):
#   - shoulders / elbows / wrists: mean distance on the common grid frames (video pixels and
#     shoulder widths);
#   - frame count and trim;
#   - continuity: the worst joint movement in logical px per 40 ms of the clip played alone, over
#     the transitions (the repo's check: limit 60, tests/avatar/avatar-edges.test.mjs) and over
#     the clip itself (shown only);
#   - forearm-angle jumps over 90 degrees between frames ("arm spinning"), on the avatar (after
#     retargeting) and on the signer's raw pose.
# PASS: at least one pair compared, the mean joint distance over all pairs <= --max-mean-sigma
# shoulder widths, and no python clip fails the continuity check where the browser clip of the
# same video passes it. The other columns show whether python is better, the same or worse.
# Run with the parity cache of the owner checklist (docs/reports/2026-10-17-py-avatar.md): the
# python candidates made with --seed-cache from the browser's cache, so both used the same split
# and the same best repetition, and only Holistic differs.
import argparse
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skcore  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
NODE_SCRIPT = os.path.join(HERE, 'parity_avatar_node.mjs')
LIMIT = 60


def candidates(cache_dir):
    """{(key, signer): {path, info}} of a cache's candidates."""
    out = {}
    root = os.path.join(cache_dir, 'candidates')
    if not os.path.isdir(root):
        return out
    for key in sorted(os.listdir(root)):
        d = os.path.join(root, key)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith('.json') or name.endswith('.info.json'):
                continue
            signer = name[:-5]
            info = skcore.read_json(os.path.join(d, signer + '.info.json'))
            out[(key, signer)] = {'path': os.path.join(d, name), 'info': info if isinstance(info, dict) else {}}
    return out


def source_of(c):
    s = c['info'].get('source')
    return s if isinstance(s, str) and s else 'browser'


def browser_ms_per_frame(cache_dir, video_id):
    """Time the page spent per Holistic frame on this video (meta.candidate.ms over the frames of
    the best rep's window): the spacing of the timestamps its smoothing filter saw, or None."""
    meta = skcore.read_json(skcore.cache_paths(cache_dir, video_id)[0]) if video_id else None
    if not isinstance(meta, dict):
        return None
    c, b = meta.get('candidate'), meta.get('bestRep')
    if not isinstance(c, dict) or not isinstance(b, dict) or not c.get('ms'):
        return None
    n = int((b['windowEndMs'] - b['windowStartMs']) // 40) + 1
    return c['ms'] / n if n > 0 else None


def main(argv=None):
    ap = argparse.ArgumentParser(description='Compare browser and python avatar candidates of the same videos.')
    ap.add_argument('--browser', required=True, help='the cache with the page\'s candidates (e.g. bulk_import_cache)')
    ap.add_argument('--python', required=True, help='the cache with the python candidates')
    ap.add_argument('--signer', action='append', default=[], help='only this signer (repeatable)')
    ap.add_argument('--max-mean-sigma', type=float, default=0.10,
                    help='PASS limit of the mean shoulder/elbow/wrist distance, in shoulder widths (default 0.10)')
    args = ap.parse_args(argv)
    node = shutil.which('node')
    if not node:
        print('node is not on the PATH: this check measures the clips with the page\'s own JavaScript.')
        return 2

    b_all, p_all = candidates(args.browser), candidates(args.python)
    pairs, only_python, only_browser, not_python, other_video = [], [], [], [], []
    for k, p in sorted(p_all.items()):
        if args.signer and k[1] not in args.signer:
            continue
        if not source_of(p).startswith('python'):
            not_python.append(k)
            continue
        b = b_all.get(k)
        if b is None:
            only_python.append(k)
            continue
        if source_of(b).startswith('python'):
            not_python.append(k)
            continue
        if b['info'].get('videoId') != p['info'].get('videoId'):
            other_video.append(k)
            continue
        pairs.append((k, b, p))
    for k, b in sorted(b_all.items()):
        if (not args.signer or k[1] in args.signer) and k not in p_all and not source_of(b).startswith('python'):
            only_browser.append(k)

    res = []
    if pairs:
        req = [{'browser': b['path'], 'python': p['path']} for _, b, p in pairs]
        proc = subprocess.run([node, NODE_SCRIPT], input=json.dumps(req).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            print('parity_avatar_node.mjs failed: ' + proc.stderr.decode('utf-8', 'replace')[-800:])
            return 2
        res = json.loads(proc.stdout.decode('utf-8'))

    head = ('%-20s %8s %5s %8s %7s %7s %13s %13s %9s %9s  %s'
            % ('sign/signer', 'frames', 'rep', 'common', 'jnt px', 'jnt sh', 'trans b/p', 'clip b/p', 'arm>90 b/p', 'raw>90 b/p', 'result'))
    print(head)
    print('-' * len(head))
    all_sigma, all_n = 0.0, 0
    cont_fail, better, same, worse = [], 0, 0, 0
    ms_frames, py_frame_ms = [], set()
    for (k, b, p), r in zip(pairs, res):
        rb, rp, j = r['browser'], r['python'], r['joints']
        name = '%s/%s' % k
        if rb.get('valid') is not True or rp.get('valid') is not True:
            print('%-20s INVALID CLIP  browser: %s  python: %s' % (name, rb.get('valid'), rp.get('valid')))
            cont_fail.append(name)
            continue
        if j['meanSigma'] is not None:
            all_sigma += j['meanSigma'] * j['compared']
            all_n += j['compared']
        tb, tp = rb['continuity']['transitions'], rp['continuity']['transitions']
        flags = []
        if tp > LIMIT and tb <= LIMIT:
            cont_fail.append(name)
            flags.append('CONTINUITY')
        ab, apy = rb['forearm']['avatar']['count'], rp['forearm']['avatar']['count']
        if apy < ab:
            better += 1
        elif apy > ab:
            worse += 1
            flags.append('more arm jumps')
        else:
            same += 1
        if rb['frames'] != rp['frames']:
            flags.append('frames %+d' % (rp['frames'] - rb['frames']))
        py_frame_ms.add(p['info'].get('frameMs'))
        mpf = browser_ms_per_frame(args.browser, b['info'].get('videoId'))
        if mpf:
            ms_frames.append(mpf)
        print('%-20s %4d/%-3d %2s/%-2s %8s %7s %7s %6.1f/%-6.1f %6.1f/%-6.1f %4d/%-4d %4d/%-4d  %s'
              % (name, rb['frames'], rp['frames'], b['info'].get('repIndex'), p['info'].get('repIndex'),
                 '%d/%d' % (j['compared'], j['frames']),
                 '—' if j['meanPx'] is None else '%.1f' % j['meanPx'],
                 '—' if j['meanSigma'] is None else '%.3f' % j['meanSigma'],
                 tb, tp, rb['continuity']['body'], rp['continuity']['body'], ab, apy,
                 rb['forearm']['signer']['count'], rp['forearm']['signer']['count'],
                 'ok' if not flags else ', '.join(flags)))
    print()
    for label, items in (('only in the python cache', only_python), ('only in the browser cache', only_browser),
                         ('not a browser/python pair (source)', not_python), ('made from another video', other_video)):
        if items:
            print('Not compared, %s: %s' % (label, ', '.join('%s/%s' % k for k in items)))
    mean = all_sigma / all_n if all_n else None
    print('Pairs compared: %d; frames with both poses: %d.' % (len(res), all_n))
    if res:
        per = {}
        for r in res:
            for jn, v in r['joints']['perJoint'].items():
                if v is not None:
                    per.setdefault(jn, []).append(v)
        print('Mean joint distance per joint (shoulder widths, mean of the videos): ' +
              ', '.join('%s %.3f' % (jn, sum(v) / len(v)) for jn, v in per.items()))
    print('Mean shoulder/elbow/wrist distance: %s shoulder widths (need <= %.2f)  %s'
          % ('—' if mean is None else '%.4f' % mean, args.max_mean_sigma,
             'ok' if mean is not None and mean <= args.max_mean_sigma else 'FAIL'))
    print('Continuity (transitions, limit %d logical px per 40 ms): %d python-only failure%s  %s'
          % (LIMIT, len(cont_fail), '' if len(cont_fail) == 1 else 's', 'ok' if not cont_fail else 'FAIL ' + ', '.join(cont_fail)))
    print('Forearm jumps > 90 deg on the avatar: python fewer on %d, same on %d, more on %d videos (shown only).' % (better, same, worse))
    if ms_frames:
        print('Browser time per Holistic frame (the timestamp spacing its smoothing saw): mean %.0f ms; python: %s ms (--avatar-frame-ms; shown only).'
              % (sum(ms_frames) / len(ms_frames), ', '.join('?' if v is None else '%g' % v for v in sorted(py_frame_ms, key=lambda v: -1 if v is None else v))))
    ok = bool(res) and mean is not None and mean <= args.max_mean_sigma and not cont_fail
    print()
    print('PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
