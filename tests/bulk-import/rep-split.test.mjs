// Bulk import, dynamic repetition split (2026-10-16, docs/reports/2026-10-16-bulk-reps-fix.md):
// js/bulk-rep-split.js on synthetic per-frame hand data, and the bulk-import-core.js helpers that
// go with it. Nothing is read from or written to the DB, saved_gestures or the cache.
// Run: node --test --test-concurrency=1 tests/bulk-import/rep-split.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Split = require('../../js/bulk-rep-split.js');
const Core = require('../../js/bulk-import-core.js');
const Knn = require('../../js/knn-compile.js');

const FPS = 15;
const tOf = (k) => Math.round(k * 1000 / FPS);

// One hand with its wrist at (x, y) and its middle knuckle 0.1 picture heights above (hand length 0.1).
function handAt(x, y) {
  const lm = Array.from({ length: 21 }, () => ({ x, y: y - 0.05, z: 0 }));
  lm[0] = { x, y, z: 0 };
  lm[9] = { x, y: y - 0.1, z: 0 };
  return { label: 'Right', score: 0.98, landmarks: lm };
}
// A video from a plan of [ms, kind] stretches at 15 fps:
//   sign   hand at signing height (y 0.40), moving (about 0.9 picture heights per second)
//   hold   hand at signing height, perfectly still (a static letter)
//   none   no hand detected
//   low    hand lowered (y 0.88), still
//   lowmv  hand lowered, moving
//   half   hand between the signing height and the lowered line (y 0.52), still
//   halfmv the same, moving
function video(plan) {
  const frames = [];
  let k = 0;
  for (const [ms, kind] of plan) {
    const count = Math.round(ms * FPS / 1000);
    for (let i = 0; i < count; i++, k++) {
      const wob = Math.sin(k * 0.9) * 0.03;      // ~0.9 picture heights / s of wrist motion
      let hands;
      if (kind === 'none') hands = [];
      else if (kind === 'sign') hands = [handAt(0.5 + wob, 0.40 + wob)];
      else if (kind === 'hold') hands = [handAt(0.5, 0.40)];
      else if (kind === 'low') hands = [handAt(0.5, 0.88)];
      else if (kind === 'lowmv') hands = [handAt(0.5 + wob, 0.88 + wob / 3)];
      else if (kind === 'half') hands = [handAt(0.5, 0.52)];
      else if (kind === 'halfmv') hands = [handAt(0.5 + wob, 0.52 + wob)];
      else throw new Error('kind ' + kind);
      frames.push({ t: tOf(k), hands });
    }
  }
  return { frames, durationMs: tOf(k), fps: FPS };
}
// the frame index where stretch i of the plan starts
const at = (plan, i) => plan.slice(0, i).reduce((n, [ms]) => n + Math.round(ms * FPS / 1000), 0);
const split = (v) => Split.splitReps(v.frames, { fps: v.fps, aspect: 4 / 3 });

test('clean video, 1 s with no hand around each rep: 3 reps, ok, each rep = its signing frames', () => {
  const plan = [[1000, 'none'], [2000, 'sign'], [1000, 'none'], [2000, 'sign'], [1000, 'none'], [2000, 'sign'], [1000, 'none']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.version, Split.SPLIT.VERSION);
  assert.deepEqual(r.reps.map((x) => [x.index, x.startFrame, x.endFrame]), [
    [1, at(plan, 1), at(plan, 2) - 1], [2, at(plan, 3), at(plan, 4) - 1], [3, at(plan, 5), at(plan, 6) - 1]]);
  r.reps.forEach((x) => { assert.equal(x.startMs, tOf(x.startFrame)); assert.equal(x.endMs, tOf(x.endFrame)); });
  assert.equal(r.cuts.length, 2);
  assert.equal(r.cuts.every((c) => c.kind === 'no hand' && c.strength === 1), true);
  assert.equal(r.profile.length, video(plan).frames.length);
});

test('the group videos: hand only lowered (still in the picture) for about 1 s, cut right after rep 3', () => {
  const plan = [[300, 'low'], [1800, 'sign'], [1000, 'low'], [1700, 'sign'], [900, 'low'], [1900, 'sign']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.reps.length, 3);
  assert.equal(r.reps[0].startFrame, at(plan, 1));
  assert.equal(r.reps[2].endFrame, video(plan).frames.length - 1, 'the last rep runs to the end of the video');
  assert.equal(r.cuts.every((c) => c.kind === 'hand lowered'), true);
  // the old segmenter (1 s with no hand detected) finds no rest at all here
});

test('the first rep may start at frame 0 (no rest before it)', () => {
  const plan = [[1500, 'sign'], [600, 'none'], [1500, 'sign'], [600, 'none'], [1500, 'sign']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.reps[0].startFrame, 0);
  assert.equal(r.reps[2].endFrame, at(plan, 5) - 1);
});

test('short rests are enough: 300 ms of no hand / of a lowered hand between the reps', () => {
  const r1 = split(video([[500, 'none'], [1500, 'sign'], [300, 'none'], [1500, 'sign'], [300, 'none'], [1500, 'sign'], [500, 'none']]));
  assert.equal(r1.reps.length, 3);
  assert.equal(r1.ok, true, r1.reasons.join('; '));
  const r2 = split(video([[1500, 'sign'], [400, 'low'], [1500, 'sign'], [400, 'low'], [1500, 'sign']]));
  assert.equal(r2.reps.length, 3);
  assert.equal(r2.ok, true, r2.reasons.join('; '));
});

test('a hand nearly still and half-way down counts as rest; the same height while moving does not', () => {
  const still = split(video([[1500, 'sign'], [900, 'half'], [1500, 'sign'], [900, 'half'], [1500, 'sign']]));
  assert.equal(still.reps.length, 3);
  assert.equal(still.cuts.every((c) => c.kind === 'hand nearly still and low'), true);
  const moving = split(video([[1500, 'sign'], [900, 'halfmv'], [1500, 'sign'], [900, 'halfmv'], [1500, 'sign']]));
  assert.equal(moving.reps.length, 1, 'no rest found');
  assert.equal(moving.ok, false);
  assert.match(moving.reasons[0], /found 1 repetition, need 3/);
});

test('a static letter held still at signing height is never a rest', () => {
  const plan = [[500, 'none'], [600, 'sign'], [1200, 'hold'], [800, 'none'], [600, 'sign'], [1200, 'hold'], [800, 'none'], [600, 'sign'], [1200, 'hold'], [500, 'none']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.deepEqual(r.reps.map((x) => [x.startFrame, x.endFrame]), [
    [at(plan, 1), at(plan, 3) - 1], [at(plan, 4), at(plan, 6) - 1], [at(plan, 7), at(plan, 9) - 1]]);
});

test('the 2 BEST rests are chosen: deepest/longest and reps of similar length win over a short dip', () => {
  // a 200 ms lowered dip inside rep 2, real rests of 1 s with no hand
  const plan = [[500, 'none'], [2000, 'sign'], [1000, 'none'], [1000, 'sign'], [200, 'lowmv'], [1000, 'sign'], [1000, 'none'], [2000, 'sign'], [500, 'none']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.deepEqual(r.reps.map((x) => [x.startFrame, x.endFrame]), [
    [at(plan, 1), at(plan, 2) - 1], [at(plan, 3), at(plan, 6) - 1], [at(plan, 7), at(plan, 8) - 1]]);
});

test('weak split: one rest is only a short half-way pause -> problem row, says why', () => {
  const r = split(video([[1500, 'sign'], [1000, 'none'], [1500, 'sign'], [300, 'half'], [1500, 'sign']]));
  assert.equal(r.reps.length, 3);
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /^no clear rest between reps 2 and 3: /);
});

test('reps of very different length -> problem row with the lengths', () => {
  const r = split(video([[500, 'none'], [600, 'sign'], [1000, 'none'], [3000, 'sign'], [1000, 'none'], [600, 'sign'], [500, 'none']]));
  assert.equal(r.reps.length, 3);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('; '), /reps of very different length \(0\.6 s, 3\.0 s, 0\.6 s\)/);
});

test('4 reps in the video -> a rival rest makes the row a problem ("more than 3 reps?")', () => {
  const r = split(video([[500, 'none'], [1500, 'sign'], [1000, 'none'], [1500, 'sign'], [1000, 'none'], [1500, 'sign'], [1000, 'none'], [1500, 'sign'], [500, 'none']]));
  assert.equal(r.reps.length, 3);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join('; '), /more than 3 reps\?/);
});

test('one rest only -> 2 reps found, problem; no rest -> 1 rep; no hand at all -> 0 reps', () => {
  const two = split(video([[500, 'none'], [1500, 'sign'], [1000, 'none'], [3000, 'sign'], [500, 'none']]));
  assert.equal(two.reps.length, 2);
  assert.equal(two.ok, false);
  assert.match(two.reasons[0], /^found 2 repetitions, need 3 \(only 1 usable rest\)$/);
  const one = split(video([[500, 'none'], [4500, 'sign'], [500, 'none']]));
  assert.equal(one.reps.length, 1);
  assert.match(one.reasons[0], /no rest between the signs/);
  const none = split(video([[3000, 'none']]));
  assert.deepEqual(none.reps, []);
  assert.equal(none.ok, false);
  assert.deepEqual(Split.splitReps([], {}).reps, []);
});

test('a moment of hand at the very start (noise) belongs to the leading rest, not to rep 1 or a cut', () => {
  const plan = [[135, 'sign'], [800, 'none'], [1500, 'sign'], [700, 'none'], [1500, 'sign'], [700, 'none'], [1500, 'sign'], [135, 'none'], [135, 'sign']];
  const r = split(video(plan));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.deepEqual(r.reps.map((x) => [x.startFrame, x.endFrame]), [
    [at(plan, 2), at(plan, 3) - 1], [at(plan, 4), at(plan, 5) - 1], [at(plan, 6), at(plan, 8) - 1 + 2]]);
});

test('a one-frame detection drop inside a rest is bridged; a one-frame drop inside a rep is not a rest', () => {
  const v = video([[500, 'none'], [1500, 'sign'], [1000, 'none'], [1500, 'sign'], [1000, 'none'], [1500, 'sign'], [500, 'none']]);
  const restFrame = at([[500], [1500], [1000]], 2) + 7;   // middle of rest 1
  v.frames[restFrame].hands = [handAt(0.5, 0.4)];
  v.frames[at([[500], [1500]], 1) + 5].hands = [];          // inside rep 1
  const r = split(v);
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.cuts.length, 2);
  assert.equal(r.cuts[0].startFrame < restFrame && r.cuts[0].endFrame > restFrame, true);
});

test('the profile: one class per frame (0 signing, 1 nearly still and low, 2 lowered, 3 no hand)', () => {
  const r = split(video([[200, 'none'], [1000, 'sign'], [200, 'low'], [200, 'half'], [200, 'hold']]));
  assert.equal(r.profile, '333' + '0'.repeat(15) + '222' + '111' + '000');
});

test('equalSplit: 3 equal parts of the time from the first to the last signing frame, each trimmed', () => {
  // signing 0..54, a lowered stretch 55..59 (the end of part 2: frames 30..59), signing 60..89
  const profile = '0'.repeat(55) + '22222' + '0'.repeat(30);
  const reps = Split.equalSplit(profile, tOf);
  assert.equal(reps.length, 3);
  assert.deepEqual(reps.map((r) => r.index), [1, 2, 3]);
  assert.equal(reps[0].startFrame, 0);
  assert.equal(reps[2].endFrame, 89);
  assert.equal(reps[1].startFrame, 30);
  assert.equal(reps[1].endFrame, 54, 'part 2 ends on its last signing frame, before the lowered stretch');
  reps.forEach((r) => assert.equal(r.startMs, tOf(r.startFrame)));
  // leading / trailing rest are left out; a part with no hand gives no rep
  assert.deepEqual(Split.equalSplit('3330000003333333333330000003333', tOf).map((r) => r.index), [1, 3]);
  assert.deepEqual(Split.equalSplit('3333', tOf), []);
  assert.deepEqual(Split.equalSplit('', tOf), []);
});

test('equalSplit on a split profile is what the Import computes again from the cache', () => {
  const v = video([[500, 'none'], [4500, 'sign'], [500, 'none']]);
  const r = split(v);
  const a = Split.equalSplit(r.profile, tOf), b = Split.equalSplit(r.profile, tOf);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(a.every((x) => Split.handFrames(r.profile, x) === x.endFrame - x.startFrame + 1), true);
});

test('handFrames from the profile = hand frames of summarizeReps on the same frames', () => {
  const v = video([[500, 'none'], [1500, 'sign'], [200, 'none'], [600, 'sign'], [1000, 'low'], [1500, 'sign'], [1000, 'none'], [1500, 'sign']]);
  const r = split(v);
  const sum = Core.summarizeReps(v, { reps: r.reps });
  r.reps.forEach((rep, i) => assert.equal(Split.handFrames(r.profile, rep), sum[i].handFrames));
});

test('thresholds can be passed in (tuning): a stricter MIN_REST_MS drops the short rests', () => {
  const v = video([[1500, 'sign'], [300, 'none'], [1500, 'sign'], [300, 'none'], [1500, 'sign']]);
  assert.equal(split(v).reps.length, 3);
  const strict = Object.assign({}, Split.SPLIT, { MIN_REST_MS: 400 });
  assert.equal(Split.splitReps(v.frames, { fps: FPS, constants: strict }).reps.length, 1);
});

// ---------- bulk-import-core.js helpers ----------

test('budgetRows = the length of KnnCompile.selectSignRows on the same row counts (compile rule)', () => {
  const cases = [[], [30], [30, 30, 30], [30, 30, 30, 1], [10, 20], Array(24).fill(30), Array(24).fill(2), [30, 0, 0, 5],
    Array(40).fill(30), [30, 25, 3, 1, 30, 30, 12], Array(31).fill(30), Array(100).fill(4)];
  for (const counts of cases) {
    const lists = counts.map((n) => Array.from({ length: n }, () => Array(126).fill(0.1)));
    assert.equal(Core.budgetRows(counts, Knn.DEFAULT_RULE), Knn.selectSignRows(lists, Knn.DEFAULT_RULE).length, JSON.stringify(counts));
  }
  // without a rule: budget 90, at least 3 rows per sample (KnnCompile.DEFAULT_RULE) -> 4 x 22
  assert.equal(Core.budgetRows([30, 30, 30, 30]), 88);
});

test('cacheState: v1 metas are old (re-extract), a v2 meta with another split version is re-split', () => {
  assert.equal(Core.cacheState(null, 1), 'none');
  assert.equal(Core.cacheState({ v: 1, seg: {}, reps: [] }, 1), 'old');
  assert.equal(Core.cacheState({ v: 2, split: { version: 1 } }, 1), 'current');
  assert.equal(Core.cacheState({ v: 2, split: { version: 1 } }, 2), 'resplit');
  assert.equal(Core.cacheState({ v: 2 }, 1), 'resplit');
});

test('importIdSourceV2: the split is part of the sample identity; a rep equal to a legacy rep keeps its legacy id', () => {
  const file = { name: 'ESL_a_P01.mp4', size: 1234, lastModified: 9 };
  const rep = { index: 2, startMs: 3000, endMs: 4467 };
  assert.equal(Core.importIdSourceV2(file, rep), 'ESL_a_P01.mp4|1234|2|3000-4467');
  assert.notEqual(Core.importIdSourceV2(file, rep), Core.importIdSourceV2(file, { ...rep, endMs: 4400 }));
  const legacy = [{ index: 1, startMs: 0, endMs: 1000 }, { index: 2, startMs: 3000, endMs: 4467 }];
  assert.equal(Core.importIdSourceV2(file, rep, legacy), Core.importIdSource(file, 2));
  assert.equal(Core.importIdSourceV2(file, { ...rep, index: 3 }, legacy), 'ESL_a_P01.mp4|1234|3|3000-4467');
});

test('splitStatus: 3 confident reps ok; otherwise a problem with the splitter\'s reasons', () => {
  const reps3 = [{ index: 1 }, { index: 2 }, { index: 3 }];
  assert.deepEqual(Core.splitStatus({ split: { ok: true, reasons: [] }, reps: reps3 }), { status: 'ok', importable: true });
  assert.deepEqual(Core.splitStatus({ split: { ok: false, reasons: ['a', 'b'] }, reps: reps3 }), { status: 'problem', reason: 'a; b', importable: true });
  assert.deepEqual(Core.splitStatus({ split: { ok: false, reasons: [] }, reps: [] }), { status: 'problem', reason: 'found 0 repetitions, need 3', importable: false });
});
