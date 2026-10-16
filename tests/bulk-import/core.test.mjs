// Bulk video importer (2026-10-13): js/bulk-import-core.js, the pure part of bulk-import.html.
// Synthetic data throughout; nothing is read from or written to the DB, saved_gestures or the cache.
// Run: node --test --test-concurrency=1 tests/bulk-import/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGestureData } from '../video-capture/load-gesture-data.mjs';

const require = createRequire(import.meta.url);
const Core = require('../../js/bulk-import-core.js');
const Clip = require('../../js/avatar-clip.js');
const Capture = require('../../js/capture-core.js');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- parseName ----------

test('parseName: good names, the label is everything between the first and the last "_"', () => {
  assert.deepEqual(Core.parseName('ESL_hello_P01.mp4'), { ok: true, set: 'ESL', label: 'hello', key: 'hello', signer: 'P01', ext: 'mp4' });
  assert.deepEqual(Core.parseName('ESL_how_are_you_P01.mp4'), { ok: true, set: 'ESL', label: 'how_are_you', key: 'how_are_you', signer: 'P01', ext: 'mp4' });
  assert.deepEqual(Core.parseName('BOTH_Thank You_P99.MOV'), { ok: true, set: 'BOTH', label: 'Thank You', key: 'thank_you', signer: 'P99', ext: 'mov' });
  assert.deepEqual(Core.parseName('FSL_p01_P10.webm'), { ok: true, set: 'FSL', label: 'p01', key: 'p01', signer: 'P10', ext: 'webm' });
  assert.equal(Core.parseName('ESL_good-morning_P02.mp4').key, 'good-morning');
  assert.equal(Core.parseName('ESL__a__P02.mp4').key, 'a');
});

test('parseName: set and signer in lower case are stored upper', () => {
  const p = Core.parseName('fsl_kamusta_ka_p07.mp4');
  assert.equal(p.ok, true);
  assert.equal(p.set, 'FSL');
  assert.equal(p.signer, 'P07');
  assert.equal(p.key, 'kamusta_ka');
  assert.equal(Core.parseName('Both_a_p12.Mp4').set, 'BOTH');
});

test('parseName: every accepted video extension, any case', () => {
  for (const ext of ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp']) {
    assert.equal(Core.parseName('ESL_a_P01.' + ext).ext, ext);
    assert.equal(Core.parseName('ESL_a_P01.' + ext.toUpperCase()).ext, ext);
  }
});

test('parseName: rejected names are "bad file name", never guessed', () => {
  const bad = [
    'ESL_hello_P00.mp4', 'ESL_hello_P100.mp4', 'ESL_hello_P1.mp4', 'ESL_hello_Q01.mp4',   // signer
    'ASL_hello_P01.mp4', 'hello_P01.mp4', '_hello_P01.mp4',                               // set
    'ESL_P01.mp4', 'ESL__P01.mp4', 'ESL_hello.mp4', 'ESL_hello_P01', 'ESL_hello_P01.',    // missing parts
    'ESLhelloP01.mp4', 'ESL hello P01.mp4', 'hello.mp4',
    'ESL_hello_P01.txt', 'ESL_hello_P01.json', 'ESL_hello_P01.mp4.txt', 'ESL_hello_P01.jpg',   // not a video
    'ESL_!!!_P01.mp4', 'ESL_ _P01.mp4', 'ESL_-_-_P01.mp4', 'ESL_ñ_P01.mp4',          // empty key
    'ESL_hello_P01 .mp4', ' ESL_hello_P01.mp4', '', null, undefined,
  ];
  for (const name of bad) assert.deepEqual(Core.parseName(name), { ok: false, reason: 'bad file name' }, String(name));
});

test('parseName: pinned edge cases', () => {
  const two = Core.parseName('ESL_a_P01_P02.mp4');   // only the LAST part is the signer
  assert.deepEqual([two.label, two.key, two.signer], ['a_P01', 'a_p01', 'P02']);
  assert.equal(Core.parseName('ESL_a.b_P01.mp4').key, 'ab');
  assert.deepEqual(Core.parseName('ESL_hello_P01.final.mp4'), { ok: false, reason: 'bad file name' });
  const both = Core.parseName('BOTH_ESL_x_P05.mov');   // only the FIRST part is the set
  assert.deepEqual([both.set, both.label, both.key, both.signer, both.ext], ['BOTH', 'ESL_x', 'esl_x', 'P05', 'mov']);
});

// ---------- cleanLabel ----------

test('cleanLabel: same result as js/gesture-data.js on a table of inputs', () => {
  const real = loadGestureData(readFileSync(path.join(repo, 'js', 'gesture-data.js'), 'utf8')).cleanLabel;
  assert.equal(typeof real, 'function');
  const inputs = [
    'hello', 'Hello', '  Thank You  ', 'how_are_you', 'HOW ARE  YOU', 'good-morning', '_lead', 'trail_', '-x-', '__a__b__',
    'a\tb\nc', 'café', 'mañana', '!!!', '', '   ', '_', '-_-', 'a.b', 'a/b\\c', '123', 'A1_b2-C3', 'what\'s up?',
    'I love you', 'x  -  y', ' nbsp ', null, undefined, 0, 42, false,
  ];
  for (const s of inputs) assert.equal(Core.cleanLabel(s), real(s), JSON.stringify(s));
  assert.equal(Core.cleanLabel('  Thank You  '), 'thank_you');
  assert.equal(Core.cleanLabel('__a__b__'), 'a__b');
  assert.equal(Core.cleanLabel('!!!'), '');
});

// ---------- ids ----------

test('videoIdSource / importIdSource: the strings to hash', () => {
  const file = { name: 'ESL_hello_P01.mp4', size: 123456, lastModified: 1760000000000 };
  assert.equal(Core.videoIdSource(file), 'ESL_hello_P01.mp4|123456|1760000000000');
  assert.equal(Core.importIdSource(file, 2), 'ESL_hello_P01.mp4|123456|2');
  // the sample identity does not depend on the modified time, the cache identity does
  const touched = { ...file, lastModified: 1 };
  assert.equal(Core.importIdSource(touched, 2), Core.importIdSource(file, 2));
  assert.notEqual(Core.videoIdSource(touched), Core.videoIdSource(file));
  assert.notEqual(Core.importIdSource(file, 1), Core.importIdSource(file, 2));
});

// ---------- summarizeReps ----------

const lm = () => Array.from({ length: 21 }, (_, j) => ({ x: 0.5 + j * 0.001, y: 0.5, z: 0 }));
const hand = (label) => ({ label, score: 0.98, landmarks: lm() });
// A v3 hands result at 15 fps from a plan of [seconds, hands per frame] stretches.
function handsResult(plan) {
  const frames = [];
  let k = 0;
  for (const [sec, n] of plan) {
    const count = Math.round(sec * 15);
    for (let i = 0; i < count; i++, k++) {
      const pattern = typeof n === 'function' ? n(i) : n;
      frames.push({ t: Math.round(k * 1000 / 15), hands: [hand('Right'), hand('Left')].slice(0, pattern) });
    }
  }
  return { frames, videoWidth: 720, videoHeight: 1280, fps: 15, durationMs: Math.round(k * 1000 / 15), input: 'video' };
}
const segment = (res) => Capture.segmentFrames(res.frames.map((f) => ({ t: f.t, handPresent: f.hands.length > 0 })), { endMs: res.durationMs });

test('summarizeReps: frames, hand frames, two-hand frames and rows per repetition', () => {
  // rep 1: 1 s one hand; rep 2: 3 s two hands; rep 3: 2 s, every third frame has two hands
  const res = handsResult([[1.2, 0], [1, 1], [1.2, 0], [3, 2], [1.2, 0], [2, (i) => (i % 3 === 0 ? 2 : 1)], [1.2, 0]]);
  const seg = segment(res);
  assert.equal(seg.ok, true);
  const reps = Core.summarizeReps(res, seg);
  assert.equal(reps.length, 3);
  assert.deepEqual(reps.map((r) => r.index), [1, 2, 3]);
  assert.deepEqual(reps.map((r) => r.frames), [15, 45, 30]);
  assert.deepEqual(reps.map((r) => r.handFrames), [15, 45, 30]);
  assert.deepEqual(reps.map((r) => r.twoHandFrames), [0, 45, 10]);
  assert.deepEqual(reps.map((r) => r.rows), [15, 30, 30]);   // MAX_ROWS_PER_RAW_SAMPLE = 30
  reps.forEach((r, i) => {
    assert.equal(r.startMs, seg.reps[i].startMs);
    assert.equal(r.endMs, seg.reps[i].endMs);
    assert.deepEqual(Object.keys(r), ['index', 'startMs', 'endMs', 'frames', 'handFrames', 'twoHandFrames', 'rows']);
  });
});

test('summarizeReps: a short drop-out inside a rep counts as a frame, not as a hand frame', () => {
  const res = handsResult([[1.2, 0], [1, 1], [0.4, 0], [1, 1], [1.2, 0]]);
  const seg = segment(res);
  assert.equal(seg.repsFound, 1);
  const reps = Core.summarizeReps(res, seg);
  assert.deepEqual(reps.map((r) => [r.frames, r.handFrames, r.twoHandFrames, r.rows]), [[36, 30, 0, 30]]);
});

test('summarizeReps: rows = what GestureDataRecorder.recordingToFeatureRows yields for the saved rep', () => {
  const real = loadGestureData(readFileSync(path.join(repo, 'js', 'gesture-data.js'), 'utf8')).recordingToFeatureRows;
  // rep 1: 3 s (45 hand frames, > 30); rep 2: 1 s (15, < 30); rep 3: 1 s + 0.4 s no hand + 0.6 s (24 of 30 frames)
  const res = handsResult([[1.2, 0], [3, 2], [1.2, 0], [1, 1], [1.2, 0], [1, 1], [0.4, 0], [0.6, 2], [1.2, 0]]);
  const seg = segment(res);
  assert.equal(seg.ok, true);
  const reps = Core.summarizeReps(res, seg);
  assert.deepEqual(reps.map((r) => [r.frames, r.handFrames, r.rows]), [[45, 45, 30], [15, 15, 15], [30, 24, 24]]);
  reps.forEach((r, i) => {
    // the frames the importer POSTs for this rep (js/gesture-capture-ui.js:613)
    const frames = res.frames.slice(seg.reps[i].startFrame, seg.reps[i].endFrame + 1);
    assert.equal(real({ frames }).length, r.rows, 'rep ' + r.index);
  });
});

test('summarizeReps: no reps', () => {
  const res = handsResult([[3, 0]]);
  assert.deepEqual(Core.summarizeReps(res, segment(res)), []);
  assert.deepEqual(Core.summarizeReps(res, { ok: false, reason: 'no-rest', repsFound: 0, reps: [] }), []);
});

// ---------- pickBestRep ----------

const rep = (index, startMs, endMs, frames, handFrames, twoHandFrames) =>
  ({ index, startMs, endMs, frames, handFrames, twoHandFrames, rows: Math.min(30, handFrames) });

test('pickBestRep: one-hand sign -> the rep with the most hand frames; window between the rest middles', () => {
  const reps = [rep(1, 1000, 2000, 16, 14, 0), rep(2, 4000, 5000, 16, 16, 1), rep(3, 7000, 8000, 16, 15, 0)];
  assert.deepEqual(Core.pickBestRep(reps, 10000), { index: 2, windowStartMs: 3000, windowEndMs: 6000 });
});

test('pickBestRep: two-hand sign -> the rep with the most two-hand frames, not the most hand frames', () => {
  // 2-hand frames 8 + 12 + 10 = 30 of 48 rep frames (>= half) -> 2 hands needed
  const reps = [rep(1, 1000, 2000, 16, 16, 8), rep(2, 4000, 5000, 16, 13, 12), rep(3, 7000, 8000, 16, 15, 10)];
  assert.equal(Core.pickBestRep(reps, 10000).index, 2);
  // exactly half counts as needed: 24 of 48
  const half = [rep(1, 1000, 2000, 16, 16, 4), rep(2, 4000, 5000, 16, 12, 12), rep(3, 7000, 8000, 16, 14, 8)];
  assert.equal(Core.pickBestRep(half, 10000).index, 2);
  // one frame under half: one hand is enough again, so the fullest rep wins
  const under = [rep(1, 1000, 2000, 16, 16, 4), rep(2, 4000, 5000, 16, 12, 12), rep(3, 7000, 8000, 16, 14, 7)];
  assert.equal(Core.pickBestRep(under, 10000).index, 1);
});

test('pickBestRep: ties go to the earlier rep', () => {
  const reps = [rep(1, 1000, 2000, 16, 16, 0), rep(2, 4000, 5000, 16, 16, 0), rep(3, 7000, 8000, 16, 16, 0)];
  assert.equal(Core.pickBestRep(reps, 10000).index, 1);
  const later = [rep(1, 1000, 2000, 16, 10, 0), rep(2, 4000, 5000, 16, 16, 0), rep(3, 7000, 8000, 16, 16, 0)];
  assert.equal(Core.pickBestRep(later, 10000).index, 2);
  // "earlier" is by time, whatever order the list is in
  assert.equal(Core.pickBestRep([reps[2], reps[1], reps[0]], 10000).index, 1);
});

test('pickBestRep: first and last rep windows use the start and the end of the video', () => {
  const first = [rep(1, 1000, 2000, 16, 16, 0), rep(2, 4000, 5000, 16, 10, 0), rep(3, 7000, 8000, 16, 10, 0)];
  assert.deepEqual(Core.pickBestRep(first, 10000), { index: 1, windowStartMs: 500, windowEndMs: 3000 });
  const last = [rep(1, 1000, 2000, 16, 10, 0), rep(2, 4000, 5000, 16, 10, 0), rep(3, 7000, 8000, 16, 16, 0)];
  assert.deepEqual(Core.pickBestRep(last, 10000), { index: 3, windowStartMs: 6000, windowEndMs: 9000 });
});

test('pickBestRep: the neighbours are ALL found reps (4 reps), a single rep, no reps', () => {
  const four = [rep(1, 1000, 2000, 16, 10, 0), rep(2, 4000, 5000, 16, 10, 0), rep(3, 7000, 8000, 16, 16, 0), rep(4, 10000, 11000, 16, 12, 0)];
  assert.deepEqual(Core.pickBestRep(four, 13000), { index: 3, windowStartMs: 6000, windowEndMs: 9000 });
  assert.deepEqual(Core.pickBestRep([rep(1, 1000, 2000, 16, 16, 16)], 4000), { index: 1, windowStartMs: 500, windowEndMs: 3000 });
  assert.equal(Core.pickBestRep([], 4000), null);
  assert.equal(Core.pickBestRep(null, 4000), null);
});

test('pickBestRep: without a finite durationMs the last rep ends its window at its own end', () => {
  const last = [rep(1, 1000, 2000, 16, 10, 0), rep(2, 4000, 5000, 16, 16, 0)];
  for (const d of [undefined, null, NaN, Infinity, '9000']) {
    assert.deepEqual(Core.pickBestRep(last, d), { index: 2, windowStartMs: 3000, windowEndMs: 5000 }, String(d));
  }
  // a rep that is not the last one does not need the duration
  const first = [rep(1, 1000, 2000, 16, 16, 0), rep(2, 4000, 5000, 16, 10, 0)];
  assert.deepEqual(Core.pickBestRep(first, undefined), { index: 1, windowStartMs: 500, windowEndMs: 3000 });
});

test('pickBestRep: seg decides how far the window of the LAST closed rep may run', () => {
  const reps = [rep(1, 1000, 2000, 16, 10, 0), rep(2, 4000, 5000, 16, 10, 0), rep(3, 7000, 8000, 16, 16, 0)];
  // a segmentation that is ok (or none given): the owner's rule
  for (const seg of [undefined, null, { ok: true }, { ok: true, reason: 'too-few-reps' }]) {
    assert.deepEqual(Core.pickBestRep(reps, 12000, seg), { index: 3, windowStartMs: 6000, windowEndMs: 10000 });
  }
  // any failed segmentation: signing the segmenter never closed may follow, so REST_MS after the
  // rep, never past the video
  for (const reason of ['too-few-reps', 'too-many-reps', 'rep-too-long', 'recording-too-long', 'no-rest', undefined]) {
    const seg = { ok: false, reason, repsFound: 3 };
    assert.deepEqual(Core.pickBestRep(reps, 12000, seg), { index: 3, windowStartMs: 6000, windowEndMs: 9000 }, reason);
    assert.equal(Core.pickBestRep(reps, 8400, seg).windowEndMs, 8400, reason);
    // a rep that is not the last closed one is not affected
    const mid = [reps[0], rep(2, 4000, 5000, 16, 16, 0), rep(3, 7000, 8000, 16, 10, 0)];
    assert.deepEqual(Core.pickBestRep(mid, 12000, seg), { index: 2, windowStartMs: 3000, windowEndMs: 6000 }, reason);
  }
  assert.equal(Core.REST_MS, Capture.CAPTURE.REST_MS);
});

// Frames with a hand after the picked rep that its window still contains (must be 0).
function handAfterRepInWindow(res, seg, best) {
  const r = seg.reps.find((x) => x.index === best.index);
  return res.frames.filter((f) => f.t > r.endMs && f.t <= best.windowEndMs && f.hands.length > 0).length;
}

test('pickBestRep: too-many-reps with an open 4th rep -> the window stops before it', () => {
  const res = handsResult([[1.2, 0], [1, 1], [1.2, 0], [1, 1], [1.2, 0], [2, 1], [1.2, 0], [3, 1]]);
  const seg = segment(res);
  assert.equal(seg.ok, false);
  assert.equal(seg.reason, 'too-many-reps');
  assert.equal(seg.repsFound, 3);
  const reps = Core.summarizeReps(res, seg);
  const best = Core.pickBestRep(reps, res.durationMs, seg);
  assert.equal(best.index, 3);
  assert.equal(best.windowEndMs, seg.reps[2].endMs + 1000);
  assert.equal(handAfterRepInWindow(res, seg, best), 0);
  // what the plain rule would do here: reach into the open 4th rep
  const plain = Core.pickBestRep(reps, res.durationMs);
  assert.equal(plain.windowEndMs, Math.round((seg.reps[2].endMs + res.durationMs) / 2));
  assert.ok(handAfterRepInWindow(res, seg, plain) > 0);
});

test('pickBestRep: too-few-reps with a rep still open at the end of the video -> the window stops before it', () => {
  // two closed reps + an open third; one closed rep + an open second
  for (const [plan, closed] of [[[[1.2, 0], [1, 1], [1.2, 0], [2, 1], [1.2, 0], [3, 1]], 2], [[[1.2, 0], [2, 1], [1.2, 0], [3, 1]], 1]]) {
    const res = handsResult(plan);
    const seg = segment(res);
    assert.equal(seg.ok, false);
    assert.equal(seg.reason, 'too-few-reps');
    assert.equal(seg.repsFound, closed);
    const reps = Core.summarizeReps(res, seg);
    const best = Core.pickBestRep(reps, res.durationMs, seg);
    assert.equal(best.index, closed);
    assert.equal(best.windowEndMs, seg.reps[closed - 1].endMs + 1000);
    assert.equal(handAfterRepInWindow(res, seg, best), 0);
    const open = res.frames.find((f) => f.t > seg.reps[closed - 1].endMs && f.hands.length > 0);
    assert.ok(best.windowEndMs < open.t, best.windowEndMs + ' < ' + open.t);
    // the plain rule would reach into the open rep
    assert.ok(handAfterRepInWindow(res, seg, Core.pickBestRep(reps, res.durationMs)) > 0);
  }
});

test('pickBestRep: rep-too-long after the last closed rep -> the window stops before the failed rep', () => {
  const res = handsResult([[1.2, 0], [1, 1], [1.2, 0], [2, 1], [1.2, 0], [21, 1], [1.2, 0]]);
  const seg = segment(res);
  assert.equal(seg.ok, false);
  assert.equal(seg.reason, 'rep-too-long');
  assert.equal(seg.repsFound, 2);
  const reps = Core.summarizeReps(res, seg);
  const best = Core.pickBestRep(reps, res.durationMs, seg);
  assert.equal(best.index, 2);
  assert.equal(best.windowEndMs, seg.reps[1].endMs + 1000);
  assert.equal(handAfterRepInWindow(res, seg, best), 0);
  const plain = Core.pickBestRep(reps, res.durationMs);
  assert.ok(handAfterRepInWindow(res, seg, plain) > 15 * 9);   // about 10 s of the failed rep
});

test('pickBestRep: on a real segmentation', () => {
  const res = handsResult([[1.2, 0], [1, 1], [1.2, 0], [2, 1], [1.2, 0], [1.5, 1], [1.2, 0]]);
  const seg = segment(res);
  const reps = Core.summarizeReps(res, seg);
  const best = Core.pickBestRep(reps, res.durationMs);
  assert.equal(best.index, 2);
  assert.equal(best.windowStartMs, Math.round((seg.reps[0].endMs + seg.reps[1].startMs) / 2));
  assert.equal(best.windowEndMs, Math.round((seg.reps[1].endMs + seg.reps[2].startMs) / 2));
  assert.ok(best.windowStartMs < seg.reps[1].startMs && best.windowEndMs > seg.reps[1].endMs);
});

// ---------- buildCandidate ----------

// One stored Holistic frame [pose, lh, rh]; wrists above the 0.6 line when `up`.
function holFrame(i, up) {
  const pose = Clip.POSE_IDX.map(() => [0.5, 0.5, -0.2, 0.99]);
  pose[Clip.P.shL] = [0.6, 0.3, -0.2, 0.99]; pose[Clip.P.shR] = [0.4, 0.3, -0.2, 0.99];
  pose[Clip.P.hipL] = [0.58, 0.8, -0.1, 0.9]; pose[Clip.P.hipR] = [0.42, 0.8, -0.1, 0.9];
  const y = up ? 0.4 : 0.9;
  pose[Clip.P.wrL] = [0.6, y, -0.3, 0.9]; pose[Clip.P.wrR] = [0.4, y, -0.3, 0.9];
  const h = () => Array.from({ length: 21 }, (_, j) => [0.4 + j * 0.001, y + i * 0.0001, -0.01]);
  return [pose, up ? h() : null, up ? h() : null];
}
const AT = '2026-10-13T00:00:00Z';
// n frames, hands up on frames a..b (inclusive).
const holistic = (n, a, b, firstFrame) => ({
  frames: Array.from({ length: n }, (_, i) => holFrame(i, i >= a && i <= b)),
  fps: 25, video: { w: 720, h: 1280, durationMs: 9000 }, firstFrame,
});

test('buildCandidate: ok -> auto-trimmed clip that passes validateClip, signer stored', () => {
  const res = Core.buildCandidate({ key: 'zz_hello', signer: 'P03', holistic: holistic(60, 10, 40, 0), AvatarClip: Clip, createdAt: AT });
  assert.equal(res.ok, true);
  const c = res.clip;
  assert.deepEqual(Clip.validateClip(c), { ok: true });
  assert.equal(c.format, 'sk_avatar_clip_v1');
  assert.equal(c.key, 'zz_hello');
  assert.equal(c.signer, 'P03');
  assert.equal(c.fps, 25);
  assert.deepEqual(c.video, { w: 720, h: 1280, durationMs: 9000 });
  assert.equal(c.createdAt, AT);
  assert.equal(c.frames.length, 31);
  assert.deepEqual(c.trim, { startMs: 400, endMs: 1600, auto: true });
  assert.deepEqual(c.frames[0], holFrame(10, true));
});

test('buildCandidate: trim times are offset by firstFrame (the window\'s place in the whole video)', () => {
  const res = Core.buildCandidate({ key: 'zz_hello', signer: 'P03', holistic: holistic(60, 10, 40, 75), AvatarClip: Clip, createdAt: AT });
  assert.equal(res.ok, true);
  assert.equal(res.clip.frames.length, 31);
  assert.deepEqual(res.clip.trim, { startMs: 3400, endMs: 4600, auto: true });   // (75+10)/25 s .. (75+40)/25 s
  assert.deepEqual(Clip.validateClip(res.clip), { ok: true });
  // without firstFrame (a full-video extraction) there is no offset
  const h = holistic(60, 10, 40, 0);
  delete h.firstFrame;
  assert.deepEqual(Core.buildCandidate({ key: 'zz_hello', signer: 'P03', holistic: h, AvatarClip: Clip, createdAt: AT }).clip.trim, { startMs: 400, endMs: 1600, auto: true });
});

test('buildCandidate: falls back to the whole window when autoTrim finds nothing', () => {
  const h = holistic(40, 99, 99, 50);   // no hand is ever raised
  assert.equal(Clip.autoTrim(h.frames), null);
  const res = Core.buildCandidate({ key: 'zz_low', signer: 'P01', holistic: h, AvatarClip: Clip, createdAt: AT });
  assert.equal(res.ok, true);
  assert.equal(res.clip.frames.length, 40);
  assert.deepEqual(res.clip.trim, { startMs: 2000, endMs: 3560, auto: false });
  assert.deepEqual(Clip.validateClip(res.clip), { ok: true });
});

test('buildCandidate: two up-runs in the window -> autoTrim keeps first run .. last run, the dip included', () => {
  const h = holistic(60, 10, 40, 0);
  for (let i = 20; i <= 29; i++) h.frames[i] = holFrame(i, false);   // hands down in the middle
  assert.deepEqual(Clip.autoTrim(h.frames), { start: 10, end: 40 });
  const res = Core.buildCandidate({ key: 'zz_two', signer: 'P02', holistic: h, AvatarClip: Clip, createdAt: AT });
  assert.equal(res.ok, true);
  assert.equal(res.clip.frames.length, 31);
  assert.deepEqual(res.clip.trim, { startMs: 400, endMs: 1600, auto: true });
  assert.deepEqual(res.clip.frames[15], holFrame(25, false));
});

test('buildCandidate: createdAt is required (the module never reaches the clock); missing parts do not throw', () => {
  const h = holistic(60, 10, 40, 0);
  const RealDate = globalThis.Date;
  globalThis.Date = function () { throw new Error('the clock was read'); };
  try {
    assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: h, AvatarClip: Clip }), { ok: false, reason: 'createdAt missing' });
    assert.equal(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: h, AvatarClip: Clip, createdAt: AT }).ok, true);
  } finally {
    globalThis.Date = RealDate;
  }
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: h, createdAt: AT }), { ok: false, reason: 'AvatarClip missing' });
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'holistic result missing' });
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: null, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'holistic result missing' });
  const noVideo = { ...h, video: undefined };
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: noVideo, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'video size missing' });
  const noFrames = { ...h, frames: undefined };
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: noFrames, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'no frames' });
  assert.equal(Core.buildCandidate().ok, false);
  assert.equal(Core.buildCandidate({}).ok, false);
});

test('buildCandidate: too long, no frames, no pose', () => {
  const long = holistic(Clip.MAX_FRAMES + 20, 5, Clip.MAX_FRAMES + 10, 0);
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: long, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'too long' });
  // exactly MAX_FRAMES kept frames is still fine
  const edge = holistic(Clip.MAX_FRAMES + 20, 5, Clip.MAX_FRAMES + 4, 0);
  const ok = Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: edge, AvatarClip: Clip, createdAt: AT });
  assert.equal(ok.ok, true);
  assert.equal(ok.clip.frames.length, Clip.MAX_FRAMES);
  // the fallback (whole window) is checked against the same limit
  const flat = holistic(Clip.MAX_FRAMES + 1, -1, -1, 0);
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: flat, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'too long' });
  const empty = { frames: [], fps: 25, video: { w: 720, h: 1280, durationMs: 9000 }, firstFrame: 0 };
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: empty, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'no frames' });
  const blank = { ...empty, frames: Array.from({ length: 10 }, () => [null, null, null]) };
  assert.deepEqual(Core.buildCandidate({ key: 'zz_x', signer: 'P01', holistic: blank, AvatarClip: Clip, createdAt: AT }), { ok: false, reason: 'no frame has a pose' });
});

// ---------- mapRow ----------

const SIGNS = {
  hello: { set: 'ESL', textEn: 'Hello', textFil: null, samples: 5, avatar: true },
  kamusta_ka: { set: 'FSL', textEn: null, textFil: 'Kamusta ka', samples: 3, avatar: false },
  thank_you: { set: 'BOTH', textEn: 'Thank you', textFil: 'Salamat', samples: 4, avatar: false },
};

test('mapRow: an existing sign with the same set is ok', () => {
  assert.deepEqual(Core.mapRow(Core.parseName('ESL_hello_P01.mp4'), SIGNS), { status: 'ok', existing: SIGNS.hello });
  assert.deepEqual(Core.mapRow(Core.parseName('both_Thank You_P02.mp4'), SIGNS), { status: 'ok', existing: SIGNS.thank_you });
});

test('mapRow: a new sign gets the draft texts its set needs', () => {
  assert.deepEqual(Core.mapRow(Core.parseName('ESL_how_are_you_P01.mp4'), SIGNS), { status: 'new', textEn: 'How are you', textFil: null });
  assert.deepEqual(Core.mapRow(Core.parseName('FSL_magandang_umaga_P01.mp4'), SIGNS), { status: 'new', textEn: null, textFil: 'Magandang umaga' });
  assert.deepEqual(Core.mapRow(Core.parseName('BOTH_ok_P01.mp4'), SIGNS), { status: 'new', textEn: 'Ok', textFil: 'Ok' });
  assert.deepEqual(Core.mapRow(Core.parseName('ESL_good-bye_P01.mp4'), {}), { status: 'new', textEn: 'Good-bye', textFil: null });
  assert.equal(Core.mapRow(Core.parseName('ESL_7_up_P01.mp4'), null).textEn, '7 up');
  // a key that is a property of every object is still a new sign
  assert.equal(Core.mapRow(Core.parseName('ESL_constructor_P01.mp4'), SIGNS).status, 'new');
});

test('mapRow: a sign that exists with another set is a problem', () => {
  assert.deepEqual(Core.mapRow(Core.parseName('FSL_hello_P01.mp4'), SIGNS), { status: 'problem', reason: 'exists as ESL', existing: SIGNS.hello });
  assert.deepEqual(Core.mapRow(Core.parseName('ESL_kamusta_ka_P01.mp4'), SIGNS), { status: 'problem', reason: 'exists as FSL', existing: SIGNS.kamusta_ka });
  assert.equal(Core.mapRow(Core.parseName('ESL_thank_you_P01.mp4'), SIGNS).reason, 'exists as BOTH');
  assert.equal(Core.mapRow(Core.parseName('BOTH_hello_P01.mp4'), SIGNS).reason, 'exists as ESL');
});

test('mapRow: sets are compared in upper case', () => {
  const signs = { hello: { set: 'esl' }, salamat: { set: 'Both' } };
  assert.deepEqual(Core.mapRow({ ok: true, set: 'ESL', key: 'hello' }, signs), { status: 'ok', existing: signs.hello });
  assert.deepEqual(Core.mapRow({ ok: true, set: 'fsl', key: 'hello' }, signs), { status: 'problem', reason: 'exists as ESL', existing: signs.hello });
  assert.equal(Core.mapRow({ ok: true, set: 'both', key: 'salamat' }, signs).status, 'ok');
  assert.deepEqual(Core.mapRow({ ok: true, set: 'fsl', key: 'zz_new' }, signs), { status: 'new', textEn: null, textFil: 'Zz new' });
});

test('mapRow: a bad file name stays a problem', () => {
  assert.deepEqual(Core.mapRow(Core.parseName('hello.mp4'), SIGNS), { status: 'problem', reason: 'bad file name' });
});

// ---------- rowStatus ----------

const metaOf = (seg, n) => ({ seg, reps: Array.from({ length: n }, (_, i) => rep(i + 1, 1000 + i * 3000, 2000 + i * 3000, 16, 16, 0)) });

test('rowStatus: exactly 3 reps and seg.ok is ok', () => {
  assert.deepEqual(Core.rowStatus(metaOf({ ok: true, reason: null, repsFound: 3 }, 3)), { status: 'ok', importable: true });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: true }, 3)), { status: 'ok', importable: true });
});

test('rowStatus: any other count is a problem with a reason; importable when a rep was found', () => {
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'too-few-reps', repsFound: 2 }, 2)),
    { status: 'problem', reason: 'found 2 repetitions, need 3', importable: true });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'too-few-reps', repsFound: 1 }, 1)),
    { status: 'problem', reason: 'found 1 repetition, need 3', importable: true });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'too-few-reps', repsFound: 0 }, 0)),
    { status: 'problem', reason: 'found 0 repetitions, need 3', importable: false });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'too-many-reps', repsFound: 4 }, 4)),
    { status: 'problem', reason: 'found 4 repetitions, need 3', importable: true });
  // 3 closed reps and a 4th still open at the end of the video
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'too-many-reps', repsFound: 3 }, 3)),
    { status: 'problem', reason: 'more than 3 repetitions', importable: true });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'no-rest', repsFound: 0 }, 0)),
    { status: 'problem', reason: 'no rest before the first sign (hands out of view for 1 s)', importable: false });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'rep-too-long', repsFound: 1 }, 1)),
    { status: 'problem', reason: 'a repetition is longer than 20 s', importable: true });
  assert.deepEqual(Core.rowStatus(metaOf({ ok: false, reason: 'recording-too-long', repsFound: 2 }, 2)),
    { status: 'problem', reason: 'the video is longer than 90 s', importable: true });
  assert.equal(Core.rowStatus({}).status, 'problem');
  assert.equal(Core.rowStatus({}).importable, false);
});

test('rowStatus: every reason segmentFrames can give is readable (no raw code shown)', () => {
  const plans = [
    [[3, 1]],                                                          // no-rest
    [[1.2, 0], [1, 1], [1.2, 0]],                                      // too-few-reps
    [[1.2, 0], [1, 1], [1.2, 0], [1, 1], [1.2, 0], [1, 1], [1.2, 0], [1, 1], [1.2, 0]],   // too-many-reps
    [[1.2, 0], [21, 1], [1.2, 0]],                                     // rep-too-long
    [[1.2, 0], [1, 1], [89, 0]],                                       // recording-too-long
  ];
  const seen = [];
  for (const plan of plans) {
    const res = handsResult(plan);
    const seg = segment(res);
    seen.push(seg.reason);
    const st = Core.rowStatus({ seg: { ok: seg.ok, reason: seg.reason, repsFound: seg.repsFound }, reps: Core.summarizeReps(res, seg) });
    assert.equal(st.status, 'problem');
    assert.equal(st.reason.includes(seg.reason), false, seg.reason);
    assert.equal(st.importable, seg.repsFound > 0);
  }
  assert.deepEqual(seen, ['no-rest', 'too-few-reps', 'too-many-reps', 'rep-too-long', 'recording-too-long']);
});

// ---------- projectRows ----------

test('projectRows: ESL = ESL + BOTH signs, FSL = FSL + BOTH signs', () => {
  const planned = [{ set: 'ESL', rows: 30 }, { set: 'ESL', rows: 12 }, { set: 'FSL', rows: 20 }, { set: 'BOTH', rows: 7 }];
  assert.deepEqual(Core.projectRows({ ESL: 1000, FSL: 200 }, planned), { ESL: 1049, FSL: 227 });
  assert.deepEqual(Core.projectRows({ ESL: 1000, FSL: 200 }, []), { ESL: 1000, FSL: 200 });
  assert.deepEqual(Core.projectRows({}, planned), { ESL: 49, FSL: 27 });
  assert.deepEqual(Core.projectRows(null, null), { ESL: 0, FSL: 0 });
});

test('projectRows: set in any case; an unknown set or a non-finite row count is ignored', () => {
  assert.deepEqual(Core.projectRows({ ESL: 10, FSL: 10 }, [{ set: 'esl', rows: 5 }, { set: 'Fsl', rows: 3 }, { set: 'both', rows: 1 }]), { ESL: 16, FSL: 14 });
  const junk = [{ set: 'ASL', rows: 30 }, { set: '', rows: 30 }, { rows: 30 }, { set: 'ESL' }, { set: 'ESL', rows: NaN },
    { set: 'FSL', rows: Infinity }, { set: 'BOTH', rows: '30' }, null, undefined, { set: 'ESL', rows: 2 }];
  assert.deepEqual(Core.projectRows({ ESL: 10, FSL: 10 }, junk), { ESL: 12, FSL: 10 });
});

// ---------- assignDefaults ----------

const cand = (...signers) => signers.map((signer) => ({ signer, frames: 40, videoId: 'a'.repeat(32), repIndex: 2, savedAt: '2026-10-13T00:00:00Z' }));
// "P01:ESL" -> a candidate of signer P01 made from an ESL video; "P02:" -> its set is not known (null)
const candSet = (...list) => list.map((x) => ({ ...cand(x.split(':')[0])[0], set: x.split(':')[1] || null }));
const emptySummary = () => ({ bySigner: {}, fallback: [], noClip: [], leftAlone: [], notImported: [], setDiffers: [] });

test('assignDefaults: the default signer where it has a candidate, else the first fallback that has one', () => {
  const res = Core.assignDefaults({
    signs: { a: { avatar: false }, b: { avatar: false }, c: { avatar: false }, d: { avatar: false } },
    candidates: { a: cand('P01', 'P02', 'P03'), b: cand('P03', 'P02'), c: cand('P03'), d: cand('P02', 'P01') },
    picks: {}, order: ['P01', 'P02', 'P03'], keepHand: true,
  });
  assert.deepEqual(res.assign, { a: 'P01', b: 'P02', c: 'P03', d: 'P01' });
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 2, P02: 1, P03: 1 },
    fallback: [{ key: 'b', signer: 'P02' }, { key: 'c', signer: 'P03' }] });
});

test('assignDefaults: no clip -> a sign with no candidate from any signer in the list', () => {
  const res = Core.assignDefaults({
    signs: { a: { avatar: false }, b: { avatar: false }, c: { avatar: false } },
    candidates: { a: cand('P01'), b: cand('P09'), c: [] },   // P09 is not in the list
    picks: {}, order: ['P01', 'P02'], keepHand: true,
  });
  assert.deepEqual(res.assign, { a: 'P01' });
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 1 }, noClip: ['b', 'c'] });
});

test('assignDefaults: keepHand on leaves hand-picked signs alone, default-picked ones are redone', () => {
  const opts = {
    signs: { a: { avatar: true }, b: { avatar: true }, c: { avatar: true }, d: { avatar: false } },
    candidates: { a: cand('P01', 'P02'), b: cand('P01', 'P02'), c: cand('P01', 'P02'), d: cand('P02') },
    picks: { a: { signer: 'P02', by: 'hand', at: 'x' }, b: { signer: 'P02', by: 'default', at: 'x' } },
    order: ['P01', 'P02'], keepHand: true,
  };
  const on = Core.assignDefaults(opts);
  // c has a clip and no picks entry: made on Avatar clips, so it counts as picked by hand
  assert.deepEqual(on.assign, { b: 'P01', d: 'P02' });
  assert.deepEqual(on.summary, { ...emptySummary(), bySigner: { P01: 1, P02: 1 }, fallback: [{ key: 'd', signer: 'P02' }], leftAlone: ['a', 'c'] });
  const off = Core.assignDefaults({ ...opts, keepHand: false });
  assert.deepEqual(off.assign, { a: 'P01', b: 'P01', c: 'P01', d: 'P02' });
  assert.deepEqual(off.summary, { ...emptySummary(), bySigner: { P01: 3, P02: 1 }, fallback: [{ key: 'd', signer: 'P02' }] });
});

test('assignDefaults: a candidate made from a video of another set is never used: skipped, listed, the next signer is the fallback', () => {
  const res = Core.assignDefaults({
    signs: { a: { set: 'FSL', avatar: false }, b: { set: 'FSL', avatar: false }, c: { set: 'ESL', avatar: false }, d: { set: 'BOTH', avatar: false }, e: { set: 'FSL', avatar: true } },
    candidates: {
      a: candSet('P01:ESL', 'P02:FSL'),      // the default signer's clip is ESL: P02 is the fallback
      b: candSet('P01:ESL', 'P02:BOTH'),     // nothing usable: listed, and NOT "no clip"
      c: candSet('P01:ESL', 'P09:FSL'),      // usable; P09 is not a listed signer: not reported
      d: candSet('P01:ESL'),                 // strict: an ESL video is not a clip for a BOTH sign
      e: candSet('P01:ESL'),                 // has a clip already (keepHand off): keeps it
    },
    picks: {}, order: ['P01', 'P02'], keepHand: false,
  });
  assert.deepEqual(res.assign, { a: 'P02', c: 'P01' });
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 1, P02: 1 }, fallback: [{ key: 'a', signer: 'P02' }], leftAlone: ['e'],
    setDiffers: [{ key: 'a', signer: 'P01', set: 'ESL' }, { key: 'b', signer: 'P01', set: 'ESL' }, { key: 'b', signer: 'P02', set: 'BOTH' },
      { key: 'd', signer: 'P01', set: 'ESL' }, { key: 'e', signer: 'P01', set: 'ESL' }] });
  assert.equal(Core.candidateUsable({ set: 'ESL' }, { set: 'FSL' }), false);
  assert.equal(Core.candidateUsable({ set: 'esl' }, { set: 'ESL' }), true);
});

test('assignDefaults: a candidate (or a sign) whose set is not known is usable', () => {
  const res = Core.assignDefaults({
    signs: { a: { set: 'FSL', avatar: false }, b: { avatar: false }, c: { set: 'FSL', avatar: false } },
    candidates: { a: candSet('P01:'), b: candSet('P01:ESL'), c: cand('P01') },   // set null / sign without a set / no set field
    picks: {}, order: ['P01'], keepHand: true,
  });
  assert.deepEqual(res.assign, { a: 'P01', b: 'P01', c: 'P01' });
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 3 } });
  for (const [c, s] of [[{ set: null }, { set: 'FSL' }], [{}, { set: 'FSL' }], [{ set: 'ESL' }, {}], [{ set: 'ESL' }, null], [null, { set: 'ESL' }], [{ set: 'XYZ' }, { set: 'ESL' }]]) {
    assert.equal(Core.candidateUsable(c, s), true, JSON.stringify([c, s]));
  }
});

test('assignDefaults: a hand-picked sign is left alone before its candidates are looked at (no setDiffers entry)', () => {
  const res = Core.assignDefaults({ signs: { a: { set: 'FSL', avatar: true } }, candidates: { a: candSet('P01:ESL') }, picks: {}, order: ['P01'], keepHand: true });
  assert.deepEqual(res, { assign: {}, summary: { ...emptySummary(), leftAlone: ['a'] } });
});

test('assignDefaults: a pick by hand left behind for a sign WITHOUT a clip does not block it', () => {
  const opts = {
    signs: { a: { avatar: false }, b: { avatar: true }, c: { avatar: false } },
    candidates: { a: cand('P01'), b: cand('P01'), c: [] },
    picks: { a: { signer: 'P02', by: 'hand', at: 'x' }, b: { signer: 'P02', by: 'hand', at: 'x' }, c: { signer: 'P02', by: 'hand', at: 'x' } },
    order: ['P01'], keepHand: true,
  };
  const res = Core.assignDefaults(opts);
  assert.deepEqual(res.assign, { a: 'P01' });                      // a: the stale pick is ignored; b: really picked by hand
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 1 }, leftAlone: ['b'], noClip: ['c'] });
});

test('assignDefaults: a sign without a clip and without a pick is not hand-picked', () => {
  const res = Core.assignDefaults({ signs: { a: { avatar: false } }, candidates: { a: cand('P01') }, picks: {}, order: ['P01'], keepHand: true });
  assert.deepEqual(res.assign, { a: 'P01' });
  assert.deepEqual(res.summary.leftAlone, []);
});

test('assignDefaults: keepHand off and no usable candidate -> an existing clip is left alone, not "no clip"', () => {
  const res = Core.assignDefaults({
    signs: { a: { avatar: true }, b: { avatar: false } }, candidates: { a: cand('P09') }, picks: {}, order: ['P01'], keepHand: false,
  });
  assert.deepEqual(res.assign, {});
  assert.deepEqual(res.summary, { ...emptySummary(), leftAlone: ['a'], noClip: ['b'] });
});

test('assignDefaults: a candidate whose sign is not imported yet -> notImported, never assigned', () => {
  const res = Core.assignDefaults({
    signs: { a: { avatar: false } },
    candidates: { a: cand('P01'), zz_new: cand('P01', 'P02'), zz_other: cand('P02'), zz_empty: [] },
    picks: { zz_new: { signer: 'P01', by: 'hand', at: 'x' } }, order: ['P01', 'P02'], keepHand: true,
  });
  assert.deepEqual(res.assign, { a: 'P01' });
  assert.deepEqual(res.summary, { ...emptySummary(), bySigner: { P01: 1 }, notImported: ['zz_new', 'zz_other'] });
});

test('assignDefaults: a key that every object inherits ("constructor") is looked up as data only', () => {
  const none = Core.assignDefaults({ signs: { constructor: { avatar: false } }, candidates: {}, picks: {}, order: ['P01'], keepHand: true });
  assert.deepEqual(none, { assign: {}, summary: { ...emptySummary(), noClip: ['constructor'] } });
  const notYet = Core.assignDefaults({ signs: {}, candidates: { constructor: [{ signer: 'P01' }] }, picks: {}, order: ['P01'], keepHand: true });
  assert.deepEqual(notYet, { assign: {}, summary: { ...emptySummary(), notImported: ['constructor'] } });
  const kept = Core.assignDefaults({ signs: { constructor: { avatar: true } }, candidates: { constructor: cand('P01') }, picks: {}, order: ['P01'], keepHand: true });
  assert.deepEqual(kept, { assign: {}, summary: { ...emptySummary(), leftAlone: ['constructor'] } });
  const used = Core.assignDefaults({ signs: { constructor: { avatar: false }, toString: { avatar: false } },
    candidates: { constructor: cand('P02'), toString: cand('P01') }, picks: {}, order: ['P01', 'P02'], keepHand: true });
  assert.deepEqual(Object.keys(used.assign).sort(), ['constructor', 'toString']);
  assert.equal(used.assign.constructor, 'P02');
  assert.equal(used.assign.toString, 'P01');
  assert.deepEqual(used.summary.fallback, [{ key: 'constructor', signer: 'P02' }]);
});

test('assignDefaults: nothing to do', () => {
  assert.deepEqual(Core.assignDefaults({ signs: {}, candidates: {}, picks: {}, order: ['P01'], keepHand: true }), { assign: {}, summary: emptySummary() });
  assert.deepEqual(Core.assignDefaults({}), { assign: {}, summary: emptySummary() });
});

// ---------- imbalance ----------

test('imbalance: median and the signs below half of it', () => {
  assert.deepEqual(Core.imbalance({ a: 6, b: 6, c: 6, d: 2, e: 3 }), { median: 6, low: ['d'] });   // 3 is exactly half: not low
  assert.deepEqual(Core.imbalance({ b: 10, a: 1, c: 2, d: 12 }), { median: 6, low: ['a', 'c'] });   // even count: mean of the middle two
  assert.deepEqual(Core.imbalance({ a: 3, b: 3, c: 3 }), { median: 3, low: [] });
  assert.deepEqual(Core.imbalance({ a: 5 }), { median: 5, low: [] });
  assert.deepEqual(Core.imbalance({ a: 0, b: 9, c: 9 }), { median: 9, low: ['a'] });
  assert.deepEqual(Core.imbalance({}), { median: 0, low: [] });
  assert.deepEqual(Core.imbalance(null), { median: 0, low: [] });
});

// ---------- the module itself ----------

test('the module is pure: no DOM, network, crypto or clock in its source', () => {
  const src = readFileSync(path.join(repo, 'js', 'bulk-import-core.js'), 'utf8').replace(/\/\/.*$/gm, '');
  for (const word of ['document', 'fetch', 'XMLHttpRequest', 'crypto', 'Date', 'localStorage', 'setTimeout', 'navigator']) {
    assert.equal(new RegExp('\\b' + word + '\\b').test(src), false, word);
  }
  assert.equal(src.includes('Math.random'), false, 'Math.random');
  assert.equal(/\brequire\s*\(/.test(src), false, 'require(');
  assert.equal(src.match(/\bmodule\b/g).length, 3);   // only the module.exports branch
  assert.equal(src.match(/\bwindow\b/g).length, 2);   // only the window.BulkImportCore attach line
});

// ---------- py-extractor phase: skipFolder, cacheSource ----------

test('skipFolder: "unzipping" and "_duplicates*" sub-folders, any case, at any depth below the chosen folder', () => {
  assert.equal(Core.skipFolder('letters/unzipping/ESL_a_P01.mp4'), true);
  assert.equal(Core.skipFolder('letters/UnZipping/ESL_a_P01.mp4'), true);
  assert.equal(Core.skipFolder('letters/_duplicates/ESL_a_P01.mp4'), true);
  assert.equal(Core.skipFolder('letters/x/_Duplicates_2026/ESL_a_P01.mp4'), true);
  assert.equal(Core.skipFolder('letters/ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder('letters/sub/ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder('letters/unzipping2/ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder('letters/x_duplicates/ESL_a_P01.mp4'), false);
  // the chosen folder itself and the file name are not looked at
  assert.equal(Core.skipFolder('unzipping/ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder('_duplicates/ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder('letters/_duplicates'), false);
  assert.equal(Core.skipFolder('ESL_a_P01.mp4'), false);
  assert.equal(Core.skipFolder(''), false);
});

test('cacheSource: python, browser, a meta from before the field (browser), no meta', () => {
  assert.deepEqual(Core.cacheSource({ source: 'python mediapipe 0.10.21' }), { kind: 'python', text: 'python mediapipe 0.10.21' });
  assert.deepEqual(Core.cacheSource({ source: 'browser mediapipe hands 0.4.1675469240' }), { kind: 'browser', text: 'browser mediapipe hands 0.4.1675469240' });
  assert.deepEqual(Core.cacheSource({ v: 2 }), { kind: 'browser', text: 'browser' });
  assert.deepEqual(Core.cacheSource(null), { kind: 'none', text: '—' });
});

test('cacheState: a python entry (split null) is split by the page from the cache', () => {
  assert.equal(Core.cacheState({ v: 2, split: null, source: 'python mediapipe 0.10.21' }, 1), 'resplit');
});

// ---------- py-avatar phase: buildMeta (moved from bulk-import-ui.js), candidateSource ----------

const Split = require('../../js/bulk-rep-split.js');
// A synthetic 3-rep video at 15 fps: a raised hand for 1.5 s, then 1 s without a hand, three times.
function threeReps() {
  const hand = (y) => ({ label: 'Right', score: 0.9, landmarks: Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.004, y: y - i * 0.01, z: 0 })) });
  const frames = [];
  for (let k = 0; k < 15 * 7.5; k++) {
    const s = (k / 15) % 2.5;
    frames.push({ t: Math.round(k * 1000 / 15), hands: s < 1.5 ? [hand(0.5 + 0.02 * Math.sin(k))] : [] });
  }
  return { videoWidth: 720, videoHeight: 1280, fps: 15, durationMs: 7500, input: { width: 320, height: 240, contentRect: { x: 92.5, y: 0, w: 135, h: 240 } }, frames };
}
const ROW = { id: 'a'.repeat(32), name: 'ESL_a_P03.mp4', size: 123, lastModified: 1700000000000, relPath: 'letters/ESL_a_P03.mp4', parsed: { set: 'ESL', label: 'a', key: 'a', signer: 'P03', ext: 'mp4' } };

test('buildMeta: the page\'s cache meta (split, reps, best rep, source, savedAt from the caller)', () => {
  const r = threeReps();
  const split = Split.splitReps(r.frames, { fps: 15, aspect: 320 / 240 });
  const m = Core.buildMeta(ROW, r, split, 1234.4, null, 'python mediapipe 0.10.21', '2026-10-17T00:00:00.000Z');
  assert.equal(m.v, Core.META_VERSION);
  assert.equal(m.id, ROW.id);
  assert.deepEqual(m.file, { name: ROW.name, size: 123, lastModified: 1700000000000, relPath: ROW.relPath });
  assert.deepEqual(m.parsed, { set: 'ESL', label: 'a', key: 'a', signer: 'P03' });
  assert.equal(m.hands.ms, 1234);
  assert.equal(m.hands.frameCount, r.frames.length);
  assert.equal(m.split.version, Split.SPLIT.VERSION);
  assert.equal(m.reps.length, split.reps.length);
  assert.equal(m.reps[0].startFrame, split.reps[0].startFrame);
  assert.deepEqual(m.bestRep, Core.pickBestRep(m.reps, 7500, { ok: true }));
  assert.equal(Core.cacheState(m, Split.SPLIT.VERSION), 'current');
  assert.equal(m.source, 'python mediapipe 0.10.21');
  assert.equal(m.savedAt, '2026-10-17T00:00:00.000Z');
  assert.equal(m.candidate, null);
  assert.deepEqual(m.imported, []);
  assert.equal(m.legacyReps, null);
});

test('buildMeta: carries over imported, legacyReps, savedAt of a v2 meta and the candidate of a clear old split', () => {
  const r = threeReps();
  const split = Split.splitReps(r.frames, { fps: 15, aspect: 320 / 240 });
  const cand = { state: 'ok', signer: 'P03', frames: 30, repIndex: 1, ms: 9, source: 'python mediapipe 0.10.21 holistic' };
  const old = { v: 2, savedAt: 'then', imported: ['x'], legacyReps: [{ index: 1, startMs: 0, endMs: 9 }], seg: { ok: true }, candidate: cand };
  const m = Core.buildMeta(ROW, r, split, 0, old, 'browser', 'now');
  assert.equal(m.savedAt, 'then');
  assert.deepEqual(m.imported, ['x']);
  assert.notEqual(m.imported, old.imported);
  assert.deepEqual(m.legacyReps, old.legacyReps);
  assert.equal(m.candidate, cand);
  assert.equal(Core.buildMeta(ROW, r, split, 0, Object.assign({}, old, { seg: { ok: false } }), 'browser', 'now').candidate, null);
  // a v1 meta: its reps become legacyReps, savedAt is new
  const v1 = Core.buildMeta(ROW, r, split, 0, { v: 1, savedAt: 'then', reps: [{ index: 1, startMs: 5, endMs: 6, frames: 3 }] }, 'browser', 'now');
  assert.deepEqual(v1.legacyReps, [{ index: 1, startMs: 5, endMs: 6 }]);
  assert.equal(v1.savedAt, 'now');
});

test('candidateSource: python, browser, a candidate from before the field (browser), none', () => {
  assert.deepEqual(Core.candidateSource({ candidate: { state: 'ok', source: 'python mediapipe 0.10.21 holistic' } }), { kind: 'python', text: 'python mediapipe 0.10.21 holistic' });
  assert.deepEqual(Core.candidateSource({ candidate: { state: 'ok', source: 'browser mediapipe holistic 0.5.1675471629' } }), { kind: 'browser', text: 'browser mediapipe holistic 0.5.1675471629' });
  assert.deepEqual(Core.candidateSource({ candidate: { state: 'ok' } }), { kind: 'browser', text: 'browser' });
  assert.deepEqual(Core.candidateSource({ candidate: { state: 'none', source: 'python mediapipe 0.10.21 holistic' } }), { kind: 'none', text: '' });
  assert.deepEqual(Core.candidateSource({ candidate: null }), { kind: 'none', text: '' });
  assert.deepEqual(Core.candidateSource(null), { kind: 'none', text: '' });
});
