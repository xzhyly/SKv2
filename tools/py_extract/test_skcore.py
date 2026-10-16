# tools/py_extract/test_skcore.py
# Checks that the Python extractor follows the page's rules: the same inputs go through skcore.py
# and, with node, through the page's real JavaScript (js_ref.mjs), and the answers must be equal.
# Needs no MediaPipe, no OpenCV and no video. Without node on the PATH the JS comparisons are skipped.
#   python -m unittest tools/py_extract/test_skcore.py -v
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import skcore  # noqa: E402

NODE = shutil.which('node')

NAMES = [
    'ESL_hello_P01.mp4', 'ESL_how_are_you_P01.mp4', 'BOTH_Thank You_P99.MOV', 'FSL_p01_P10.webm',
    'ESL_good-morning_P02.mp4', 'ESL__a__P02.mp4', 'fsl_kamusta_ka_p07.mp4', 'Both_a_p12.Mp4',
    'ESL_a_P01.webm', 'ESL_a_P01.mkv', 'ESL_a_P01.avi', 'ESL_a_P01.m4v', 'ESL_a_P01.3gp', 'ESL_a_P01.mov',
    'ESL_a_P00.mp4', 'ESL_a_P100.mp4', 'ESL_a_P1.mp4', 'ESL_a_Q01.mp4', 'ASL_a_P01.mp4', 'ESL_a_P01.txt',
    'ESL_a_P01', 'ESL_P01.mp4', 'ESL__P01.mp4', 'ESL_!!!_P01.mp4', 'ESL_ñ_P01.mp4', 'ESL_café_P01.mp4',
    'ESL_a b\tc_P01.mp4', 'ESL_ x　y_P01.mp4', 'ESL_﻿z_P01.mp4', 'ESL_a\nb_P01.mp4',
    'ESL_a_P01.mp4\n', 'esl_A_p01.MP4', 'ESL_K_P01.mp4', 'KSL_a_P01.mp4', 'ESL_İstanbul_P01.mp4',
    'ESL_a_P01.mp4.mp4', 'ESL_a_P01_P02.mp4', 'ESL_x_y_P05.webm', 'BOTH_constructor_P03.mp4',
    'ESL_-_P01.mp4', 'ESL_a-_-b_P01.mp4', 'ESL_A_B_P01.MOV', 'ESL_📷_P01.mp4', 'ESL_a📷b_P01.mp4',
    'hello_final.webm', 'desktop.ini', '', 'ESL_a_P01.Mp4 ', ' ESL_a_P01.mp4',
]
JUNK = ['desktop.ini', 'Desktop.INI', 'Thumbs.db', 'ehthumbs.db', '.DS_Store', '.hidden', '~$doc.docx',
        'ESL_a_P01.mp4', 'hello.webm', 'thumbs.db.bak', '.', '~$', 'x.ds_store']
RELS = ['letters/unzipping/ESL_a_P01.mp4', 'letters/UNZIPPING/a.mp4', 'letters/_duplicates/a.mp4',
        'letters/a/_Duplicates_x/b/a.mp4', 'letters/a.mp4', 'unzipping/a.mp4', '_duplicates/a.mp4',
        'letters/unzipping2/a.mp4', 'letters/x_duplicates/a.mp4', 'letters/_duplicates', 'a.mp4', '',
        'P05/ESL/words/_duplicates_2026-10-01/ESL_a_P05.mp4']
IDS = [('ESL_hello_P01.mp4', 1234567, 1792137601123), ('ESL_café_P01.mp4', 0, 0),
       ('ESL_📷_P01.mp4', 9007199254740, 1700000000000), ('BOTH_Thank You_P99.MOV', 18_000_000_000, 1792137601999)]
LETTERBOX = [(1280, 720, 320, 240), (720, 1280, 320, 240), (640, 480, 320, 240), (640, 360, 320, 240),
             (480, 640, 320, 240), (1080, 1920, 320, 240), (1920, 1080, 320, 240), (360, 202, 320, 240),
             (1440, 1080, 320, 240), (854, 480, 320, 240), (1000, 1001, 320, 240)]
SEEKS = [(2.0, 15), (17.8, 15), (0.6666666, 15), (10.01, 15), (1.0, 15), (59.97, 15), (7.6, 15), (0.001, 15)]
ROUNDS = [0.5, 1.5, 2.5, -0.5, -1.5, 66.66666666666667, 1253.4999999, 1253.5, 0.49999999999999994, 1e15 + 0.5]


def run_js(queries):
    out = subprocess.run([NODE, os.path.join(HERE, 'js_ref.mjs')], input=json.dumps(queries).encode('utf-8'),
                         capture_output=True, check=True)
    return json.loads(out.stdout.decode('utf-8'))


@unittest.skipUnless(NODE, 'node is not on the PATH')
class SameAsJavaScript(unittest.TestCase):
    def test_parse_name(self):
        js = run_js([{'fn': 'parseName', 'args': [n]} for n in NAMES])
        for name, want in zip(NAMES, js):
            self.assertEqual(skcore.parse_name(name), want, repr(name))

    def test_clean_label(self):
        labels = ['  Hello  World ', 'a b', '﻿x', 'A-B_C', '__x__', '-y-', 'Ñandú', 'x\x1cy', 'İ', 'K']
        js = run_js([{'fn': 'cleanLabel', 'args': [s]} for s in labels])
        for s, want in zip(labels, js):
            self.assertEqual(skcore.clean_label(s), want, repr(s))

    def test_junk(self):
        js = run_js([{'fn': 'junk', 'args': [n]} for n in JUNK])
        for name, want in zip(JUNK, js):
            self.assertEqual(skcore.is_junk(name), want, repr(name))

    def test_skip_folder(self):
        js = run_js([{'fn': 'skipFolder', 'args': [r]} for r in RELS])
        for rel, want in zip(RELS, js):
            self.assertEqual(skcore.skip_folder(rel), want, repr(rel))

    def test_video_id(self):
        js = run_js([{'fn': 'videoId', 'args': list(t)} for t in IDS])
        for t, want in zip(IDS, js):
            self.assertEqual(skcore.sha32(skcore.video_id_source(*t)), want, repr(t))

    def test_letterbox(self):
        js = run_js([{'fn': 'letterboxRect', 'args': list(t)} for t in LETTERBOX])
        for t, want in zip(LETTERBOX, js):
            self.assertEqual(skcore.letterbox_rect(*t), want, repr(t))

    def test_seek_times(self):
        js = run_js([{'fn': 'seekTimes', 'args': list(t)} for t in SEEKS])
        for t, want in zip(SEEKS, js):
            self.assertEqual(skcore.seek_times(*t), want, repr(t))

    def test_math_round(self):
        js = run_js([{'fn': 'mathRound', 'args': [x]} for x in ROUNDS])
        for x, want in zip(ROUNDS, js):
            self.assertEqual(skcore.js_round(x), want, repr(x))


class Rules(unittest.TestCase):
    def test_round_dp(self):
        self.assertEqual(skcore.round_dp(0.12345, 4), 0.1235 if 0.12345 * 10000 >= 1234.5 else 0.1234)
        self.assertEqual(skcore.round_dp(-0.00001, 4), 0)
        self.assertEqual(json.dumps(skcore.round_dp(-0.00001, 4)), '0')
        self.assertEqual(json.dumps(skcore.round_dp(0.99999, 4)), '1')
        self.assertEqual(skcore.round_dp(0.98765, 3), 0.988)

    def test_last_modified_rounds_down(self):
        class St:
            st_mtime_ns = 1792137601123999999
        self.assertEqual(skcore.last_modified_ms(St), 1792137601123)

    def test_scan_folder(self):
        with tempfile.TemporaryDirectory() as d:
            root = os.path.join(d, 'letters')
            for rel in ['ESL_b_P01.mp4', 'sub/ESL_a_P02.webm', 'unzipping/ESL_c_P01.mp4', '_duplicates_x/ESL_d_P01.mp4',
                        'hello_final.webm', 'desktop.ini', 'sub2/ESL_b_P01.mp4', 'ESL_e_P01.mp4']:
                p = os.path.join(root, *rel.split('/'))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'wb') as f:
                    f.write(b'x' * (3 if rel.endswith('e_P01.mp4') else 5))
                os.utime(p, ns=(1792137601123456789, 1792137601123456789))
            s = skcore.scan_folder(root)
            self.assertEqual(s['files'], 8)
            self.assertEqual(s['ignored'], 1)
            self.assertEqual(s['skipped'], 2)
            self.assertEqual([v['relPath'] for v in s['videos']], ['letters/sub/ESL_a_P02.webm', 'letters/ESL_b_P01.mp4', 'letters/ESL_e_P01.mp4'])
            # the same name, size and modified time in another sub-folder: one cache entry, a problem
            self.assertEqual([(p['relPath'], p['reason']) for p in s['problems']],
                             [('letters/sub2/ESL_b_P01.mp4', 'same file as letters/ESL_b_P01.mp4'),
                              ('letters/hello_final.webm', 'bad file name')])
            self.assertEqual(s['videos'][1]['lastModified'], 1792137601123)
            self.assertEqual(s['videos'][1]['id'], skcore.sha32('ESL_b_P01.mp4|5|1792137601123'))

    def test_carry_over(self):
        self.assertEqual(skcore.carry_over(None)['imported'], [])
        v1 = {'v': None, 'seg': {'ok': True}, 'candidate': {'state': 'ok', 'frames': 9}, 'imported': ['a' * 32],
              'reps': [{'index': 1, 'startMs': 0, 'endMs': 900, 'frames': 9}], 'savedAt': 'x'}
        c = skcore.carry_over(v1)
        self.assertEqual(c['legacyReps'], [{'index': 1, 'startMs': 0, 'endMs': 900}])
        self.assertEqual(c['candidate'], v1['candidate'])
        self.assertEqual(c['seg'], v1['seg'])
        self.assertIsNone(c['savedAt'])
        bad = dict(v1, seg={'ok': False})
        self.assertIsNone(skcore.carry_over(bad)['candidate'])
        v2 = {'v': 2, 'legacyReps': [{'index': 2}], 'seg': {'ok': True}, 'candidate': {'state': 'none'}, 'savedAt': 's'}
        c = skcore.carry_over(v2)
        self.assertEqual(c['legacyReps'], [{'index': 2}])
        self.assertIsNone(c['candidate'])
        self.assertEqual(c['savedAt'], 's')

    def test_cache_state_and_write(self):
        with tempfile.TemporaryDirectory() as d:
            vid = 'a' * 32
            self.assertEqual(skcore.cache_state(d, vid)[0], 'none')
            meta_p, hands_p = skcore.cache_paths(d, vid)
            skcore.write_atomic(meta_p, {'v': 2, 'id': vid})
            self.assertEqual(skcore.cache_state(d, vid)[0], 'old')        # no hands file
            skcore.write_atomic(hands_p, {'v': 2, 'id': vid, 'frames': []})
            self.assertEqual(skcore.cache_state(d, vid)[0], 'cached')
            skcore.write_atomic(meta_p, {'id': vid, 'reps': []})        # version 1
            self.assertEqual(skcore.cache_state(d, vid)[0], 'old')
            self.assertEqual(sorted(os.listdir(os.path.join(d, 'videos'))), [vid + '.hands.json', vid + '.meta.json'])
            with open(meta_p, encoding='utf-8') as f:
                self.assertEqual(f.read(), '{"id":"' + vid + '","reps":[]}')


if __name__ == '__main__':
    unittest.main()
