# tools/py_extract/test_avatar.py
# The avatar pass (avatar_pass.py) against the page's own readers:
#   - the candidate written by Python is read back by php/api/bulk_import.php (php -S on a temp copy:
#     ?action=candidates and ?action=candidate, the requests Step 5 and avatar-clips.html send), its
#     clip passes AvatarClip.validateClip / importClip, and BulkImportCore.assignDefaults picks it;
#   - the split op gives the page's meta (cacheState 'current', the page's best rep);
#   - the rules: signer list, key check, which file of a sign and signer makes the clip, never
#     replacing a stored candidate without --overwrite;
#   - the Holistic window reader: grid frames, firstFrame, rotation, on a small synthetic video
#     (needs mediapipe + OpenCV; skipped without them).
# Needs node (and php for the endpoint test); without them those tests are skipped.
#   python -m unittest tools/py_extract/test_avatar.py -v
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import skcore  # noqa: E402
import avatar_pass  # noqa: E402

NODE = shutil.which('node')
PHP = shutil.which('php')
try:
    import cv2  # noqa: F401
    import mediapipe  # noqa: F401
    HAVE_MP = True
except Exception:
    HAVE_MP = False


def raw_frames(n, hands=True):
    """n raw Holistic frames: a pose with the right wrist raised, and both hands."""
    out = []
    for i in range(n):
        pose = [[0.5, 0.5, 0.0, 0.99] for _ in range(33)]
        pose[0] = [0.5, 0.2 + i * 1e-4, -0.3, 0.99]                     # nose
        pose[7], pose[8] = [0.55, 0.21, 0, 0.9], [0.45, 0.21, 0, 0.9]   # ears
        pose[11], pose[12] = [0.62, 0.35, 0, 0.99], [0.38, 0.35, 0, 0.99]  # shoulders
        pose[13], pose[14] = [0.66, 0.55, 0, 0.9], [0.30, 0.45, 0, 0.9]   # elbows
        pose[15], pose[16] = [0.68, 0.75, 0, 0.9], [0.33, 0.30 + i * 0.001, 0, 0.9]  # wrists: right one up
        pose[23], pose[24] = [0.58, 0.85, 0, 0.9], [0.42, 0.85, 0, 0.9]   # hips
        hand = [[0.33 + j * 0.003, 0.28 - j * 0.004, -0.01 * j] for j in range(21)] if hands else None
        out.append([pose, hand, hand])
    return out


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


@unittest.skipUnless(NODE, 'node is not on the PATH')
class PageCode(unittest.TestCase):
    def test_info(self):
        info = avatar_pass.run_node([{'op': 'info'}])[0]
        self.assertEqual(info['metaVersion'], skcore.META_VERSION)
        self.assertIsInstance(info['splitVersion'], int)

    def test_candidate_is_the_page_clip(self):
        res = {'frames': raw_frames(30), 'fps': 25, 'video': {'w': 720, 'h': 1280, 'durationMs': 9000}, 'firstFrame': 50}
        out = avatar_pass.run_node([{'op': 'candidate', 'key': 'a', 'signer': 'P03', 'holistic': res,
                                     'createdAt': '2026-10-17T00:00:00.000Z', 'source': 'python mediapipe 0.10.21 holistic'}])[0]
        self.assertTrue(out['ok'], out)
        clip = out['clip']
        self.assertEqual(clip['format'], 'sk_avatar_clip_v1')
        self.assertEqual(clip['poseIdx'], [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24])
        self.assertEqual(clip['extractor'], {'lib': 'python mediapipe 0.10.21 holistic', 'modelComplexity': 1})
        self.assertEqual(clip['signer'], 'P03')
        self.assertEqual(clip['fps'], 25)
        # trim times are grid times of the whole video: firstFrame 50 -> 2000 ms
        self.assertGreaterEqual(clip['trim']['startMs'], 2000)
        self.assertEqual(clip['trim']['startMs'] % 40, 0)
        # packFrame rounding: 3 decimals, visibility 2
        self.assertEqual(clip['frames'][0][0][3], [0.62, 0.35, 0, 0.99])
        self.assertEqual(clip['frames'][0][0][0][1], 0.2)

    def test_candidate_without_pose_is_refused_like_the_page(self):
        res = {'frames': [[None, None, None]] * 5, 'fps': 25, 'video': {'w': 720, 'h': 1280, 'durationMs': 9000}, 'firstFrame': 0}
        out = avatar_pass.run_node([{'op': 'candidate', 'key': 'a', 'signer': 'P03', 'holistic': res,
                                     'createdAt': '2026-10-17T00:00:00.000Z', 'source': 'x'}])[0]
        self.assertEqual(out, {'ok': False, 'reason': 'no frame has a pose'})
        empty = dict(res, frames=[], firstFrame=None)
        self.assertEqual(avatar_pass.run_node([{'op': 'candidate', 'key': 'a', 'signer': 'P03', 'holistic': empty,
                                                'createdAt': 'x', 'source': 'x'}])[0], {'ok': False, 'reason': 'no frames'})

    def test_split_op_writes_the_page_meta(self):
        tmp = tempfile.mkdtemp()
        try:
            frames = []
            for k in range(int(15 * 7.5)):
                up = (k / 15) % 2.5 < 1.5
                frames.append({'t': skcore.js_round(k * 1000 / 15), 'hands': [{'label': 'Right', 'score': 0.9, 'landmarks': [
                    {'x': 0.5 + i * 0.004, 'y': 0.5 - i * 0.01, 'z': 0} for i in range(21)]}] if up else []})
            hm = {'videoWidth': 720, 'videoHeight': 1280, 'fps': 15, 'durationMs': 7500,
                  'input': {'width': 320, 'height': 240, 'contentRect': {'x': 92.5, 'y': 0, 'w': 135, 'h': 240}}}
            vid = 'b' * 32
            meta_p, hands_p = skcore.cache_paths(tmp, vid)
            skcore.write_atomic(hands_p, {'id': vid, 'v': 2, 'meta': hm, 'frames': frames, 'source': 'python mediapipe 0.10.21'})
            row = {'id': vid, 'name': 'ESL_a_P03.mp4', 'size': 1, 'lastModified': 2, 'relPath': 'x/ESL_a_P03.mp4',
                   'parsed': {'set': 'ESL', 'label': 'a', 'key': 'a', 'signer': 'P03', 'ext': 'mp4'}}
            meta = {'v': 2, 'id': vid, 'hands': dict(hm, frameCount=len(frames), handFrames=1, ms=5), 'split': None,
                    'reps': [], 'bestRep': None, 'candidate': None, 'imported': [], 'legacyReps': None, 'seg': None,
                    'savedAt': '2026-01-01T00:00:00.000Z', 'source': 'python mediapipe 0.10.21', 'extractor': {}}
            skcore.write_atomic(meta_p, meta)
            row['_meta'] = meta
            self.assertEqual(avatar_pass.split_from_cache([row], tmp), [])
            m = skcore.read_json(meta_p)
            info = avatar_pass.run_node([{'op': 'info'}])[0]
            self.assertEqual(m['split']['version'], info['splitVersion'])
            self.assertEqual(len(m['reps']), 3)
            self.assertIsNotNone(m['bestRep'])
            self.assertEqual(m['source'], 'python mediapipe 0.10.21')
            self.assertEqual(m['savedAt'], '2026-01-01T00:00:00.000Z')
            self.assertEqual(m['hands']['ms'], 5)
            self.assertEqual(json.loads(skcore.dumps(m)), m)
        finally:
            shutil.rmtree(tmp)


class Rules(unittest.TestCase):
    def test_parse_signers(self):
        self.assertEqual(avatar_pass.parse_signers('P03,p01, P03 ,'), ['P03', 'P01'])
        self.assertEqual(avatar_pass.parse_signers(''), [])
        for bad in ('P3', 'P00', 'P100', 'Q01', 'P01;P02'):
            with self.assertRaises(ValueError):
                avatar_pass.parse_signers(bad)

    def test_valid_key(self):
        self.assertTrue(avatar_pass.valid_key('how_are_you'))
        for bad in ('', 'con', 'NUL'.lower(), 'a' * 101, 'A', 'a b'):
            self.assertFalse(avatar_pass.valid_key(bad), bad)

    def test_which_file_makes_the_clip(self):
        tmp = tempfile.mkdtemp()
        try:
            def r(i, cand=None):
                return {'id': str(i) * 32, 'parsed': {'key': 'a', 'signer': 'P03'},
                        '_meta': {'candidate': cand}}
            a, b, c = r(1), r(2), r(3)
            pair = [a, b, c]
            self.assertIs(avatar_pass.next_in_pair(pair, tmp, False, {}), a)          # the first file
            self.assertIs(avatar_pass.next_in_pair(pair, tmp, False, {a['id']: 'none'}), b)
            self.assertIs(avatar_pass.next_in_pair(pair, tmp, False, {a['id']: 'failed', b['id']: 'none'}), c)
            self.assertIsNone(avatar_pass.next_in_pair(pair, tmp, False, {a['id']: 'ok'}))
            # an earlier run's answers in the metas
            a2 = r(1, {'state': 'none', 'reason': 'x'})
            self.assertIs(avatar_pass.next_in_pair([a2, b], tmp, False, {}), b)
            a3 = r(1, {'state': 'ok'})
            self.assertIsNone(avatar_pass.next_in_pair([a3, b], tmp, False, {}))
            self.assertIs(avatar_pass.next_in_pair([a3, b], tmp, True, {}), a3)     # --overwrite
            # a stored candidate (here: the browser's, no source) is never replaced without --overwrite
            clip_p, info_p = avatar_pass.candidate_paths(tmp, 'a', 'P03')
            skcore.write_atomic(clip_p, {'videoId': '9' * 32, 'clip': {}})
            skcore.write_atomic(info_p, {'signer': 'P03', 'videoId': '9' * 32})
            self.assertEqual(avatar_pass.candidate_owner(tmp, 'a', 'P03'), {'videoId': '9' * 32, 'source': 'browser'})
            self.assertIsNone(avatar_pass.next_in_pair(pair, tmp, False, {}))
            self.assertIs(avatar_pass.next_in_pair(pair, tmp, True, {}), a)
        finally:
            shutil.rmtree(tmp)


@unittest.skipUnless(NODE and PHP, 'node and php are needed')
class ReadByThePage(unittest.TestCase):
    """The files Python writes, read through php/api/bulk_import.php (a temp copy of the repo's PHP,
    served by php -S) and the page's JavaScript."""

    def test_candidate_through_the_endpoint_and_the_page_code(self):
        tmp = tempfile.mkdtemp()
        proc = None
        try:
            os.makedirs(os.path.join(tmp, 'php', 'api'))
            for f in ('bulk_import.php', 'sign_meta.php'):
                shutil.copy(os.path.join(REPO, 'php', 'api', f), os.path.join(tmp, 'php', 'api', f))
            cache = os.path.join(tmp, 'bulk_import_cache')
            res = {'frames': raw_frames(20), 'fps': 25, 'video': {'w': 720, 'h': 1280, 'durationMs': 9000}, 'firstFrame': 10}
            src = 'python mediapipe 0.10.21 holistic'
            clip = avatar_pass.run_node([{'op': 'candidate', 'key': 'thank_you', 'signer': 'P05', 'holistic': res,
                                          'createdAt': avatar_pass.now_iso_ms(), 'source': src}])[0]['clip']
            vid = 'c' * 32
            avatar_pass.write_candidate(cache, 'thank_you', 'P05', 'BOTH', vid, 2, clip, src)
            port = free_port()
            proc = subprocess.Popen([PHP, '-S', '127.0.0.1:%d' % port, '-t', tmp], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            base = 'http://127.0.0.1:%d/php/api/bulk_import.php?' % port
            for _ in range(50):
                try:
                    listing = json.loads(urllib.request.urlopen(base + 'action=candidates').read())
                    break
                except OSError:
                    time.sleep(0.1)
            one = json.loads(urllib.request.urlopen(base + 'action=candidate&key=thank_you&signer=P05').read())
            self.assertTrue(listing['success'])
            entry = listing['candidates']['thank_you'][0]
            self.assertEqual({k: entry[k] for k in ('signer', 'set', 'frames', 'videoId', 'repIndex')},
                             {'signer': 'P05', 'set': 'BOTH', 'frames': len(clip['frames']), 'videoId': vid, 'repIndex': 2})
            self.assertRegex(entry['savedAt'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$')
            self.assertEqual(one['candidate']['clip'], clip)
            # the page's JavaScript on what the endpoint returned
            js = r'''
              const Core = require(process.argv[1] + '/js/bulk-import-core.js');
              const Clip = require(process.argv[1] + '/js/avatar-clip.js');
              const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
              const imp = Clip.importClip(d.one.candidate.clip);
              const a = Core.assignDefaults({ signs: { thank_you: { set: 'BOTH', avatar: false } }, candidates: d.listing.candidates,
                                              picks: {}, order: ['P03', 'P05'] });
              console.log(JSON.stringify({ valid: Clip.validateClip(d.one.candidate.clip), imp: imp.ok && imp.source, assign: a.assign }));
            '''
            out = subprocess.run([NODE, '-e', js, REPO], input=json.dumps({'listing': listing, 'one': one}).encode('utf-8'),
                                 capture_output=True, check=True)
            got = json.loads(out.stdout.decode('utf-8'))
            self.assertEqual(got, {'valid': {'ok': True}, 'imp': 'clip', 'assign': {'thank_you': 'P05'}})
        finally:
            if proc:
                proc.terminate()
                proc.wait()
            shutil.rmtree(tmp)


@unittest.skipUnless(HAVE_MP, 'mediapipe / OpenCV not installed')
class WindowReader(unittest.TestCase):
    def test_grid_frames_and_first_frame(self):
        import cv2  # noqa: F811
        import numpy as np
        tmp = tempfile.mkdtemp()
        try:
            path = os.path.join(tmp, 'ESL_a_P03.avi')
            w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*'MJPG'), 30, (1280, 720))
            for i in range(90):                      # 3.0 s at 30 fps
                img = np.full((720, 1280, 3), (i * 2) % 255, np.uint8)
                w.write(img)
            w.release()
            ex = avatar_pass.HolisticExtractor(40000)
            res = ex.run(path, 1000, 2000, 3.0)
            # grid times k/25 with 1000 <= k*40 <= 2000: k = 25..50
            self.assertEqual(res['firstFrame'], 25)
            self.assertEqual(len(res['frames']), 26)
            self.assertEqual(res['video'], {'w': 1280, 'h': 720, 'durationMs': 3000})
            self.assertEqual(res['fps'], 25)
            # the same with every frame converted (no skipped frames before the window)
            res2 = ex.run(path, 1000, 2000, 3.0, margin_ms=None)
            self.assertEqual(len(res2['frames']), 26)
            # a window with no grid time: no frames, firstFrame None
            res3 = ex.run(path, 1001, 1020, 3.0)
            self.assertEqual((res3['frames'], res3['firstFrame']), ([], None))
            # the end of the video: the last grid time is clamped inside it
            res4 = ex.run(path, 2900, 5000, 3.0)
            self.assertEqual((res4['firstFrame'], len(res4['frames'])), (73, 2))
        finally:
            shutil.rmtree(tmp)


if __name__ == '__main__':
    unittest.main()
