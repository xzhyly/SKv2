// Unit tests for the pure avatar modules: clip codec + auto-trim, retargeting (no stretch, face
// region, missing hands), timeline (blend continuity, rest pose at both ends) and the missing-clip
// fallback split. Thresholds: docs/reports/2026-10-05-avatar-step1.md (d) and Q14.
// Run: node --test tests/avatar/avatar-math.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rig, Clip, Retarget, Timeline, haveSample, sampleFrames, sampleClip, jointsOf, maxJump } from './helper.mjs';

const JUMP_MAX = 60;     // logical px per 40 ms frame across a sign boundary (Q14)
const STEP = 40;         // ms

const skipNoSample = haveSample ? false : 'sample clip not present (C:/Users/ADMIN/Downloads/Avatar)';

test('auto-trim on the sample clip is frames 31..221', { skip: skipNoSample }, () => {
  const { frames } = sampleFrames();
  assert.deepEqual(Clip.autoTrim(frames), { start: 31, end: 221 });
});

test('auto-trim: no raised hand -> null; a 2-frame blip is ignored', () => {
  const down = [[0.5, 0.2, 0, 1], [0.6, 0.2, 0, 1], [0.4, 0.2, 0, 1], [0.6, 0.5, 0, 1], [0.4, 0.5, 0, 1],
    [0.65, 0.7, 0, 1], [0.35, 0.7, 0, 1], [0.65, 0.95, 0, 1], [0.35, 0.95, 0, 1], [0.6, 1.0, 0, 1], [0.4, 1.0, 0, 1]];
  const up = down.map((p) => p.slice());
  up[8] = [0.35, 0.6, 0, 1];
  const f = (pose) => [pose, null, null];
  assert.equal(Clip.autoTrim([f(down), f(down), f(down)]), null);
  assert.equal(Clip.autoTrim([f(down), f(up), f(up), f(down)]), null);
  assert.deepEqual(Clip.autoTrim([f(down), f(up), f(up), f(up), f(down), f(up), f(up), f(up), f(up), f(down)]), { start: 1, end: 8 });
});

test('buildClip keeps only the trimmed frames; validateClip accepts it and rejects bad input', { skip: skipNoSample }, () => {
  const c = sampleClip();
  assert.equal(c.frames.length, 191);
  assert.equal(c.trim.startMs, 1240);
  assert.equal(c.trim.endMs, 8840);
  assert.deepEqual(Clip.validateClip(c), { ok: true });
  assert.equal(Clip.validateClip({ ...c, format: 'x' }).ok, false);
  assert.equal(Clip.validateClip({ ...c, frames: [] }).ok, false);
  assert.equal(Clip.validateClip({ ...c, frames: new Array(501).fill(c.frames[0]) }).ok, false);
  assert.equal(Clip.validateClip({ ...c, frames: [[c.frames[0][0].slice(0, 5), null, null]] }).ok, false);
  assert.equal(Clip.validateClip({ ...c, frames: [[c.frames[0][0], [[0, 0]], null]] }).ok, false);
  assert.equal(Clip.validateClip({ ...c, frames: [[null, null, null]] }).ok, false);
  const nan = JSON.parse(JSON.stringify(c));
  nan.frames[0][0][0][0] = 'x';
  assert.equal(Clip.validateClip(nan).ok, false);
});

test('packFrame rounds to 3 decimals and keeps pose visibility', () => {
  const pl = Array.from({ length: 33 }, (_, i) => ({ x: i / 100 + 0.00012, y: 0.5, z: -0.12345, visibility: 0.987 }));
  const f = Clip.packFrame({ poseLandmarks: pl, rightHandLandmarks: Array.from({ length: 21 }, () => ({ x: 0.11111, y: 0.2, z: 0 })) });
  assert.equal(f[0].length, 11);
  assert.deepEqual(f[0][3], [0.11, 0.5, -0.123, 0.99]);
  assert.equal(f[1], null);
  assert.deepEqual(f[2][0], [0.111, 0.2, 0]);
});

test('retarget: no bone is ever longer than the avatar bone (no stretch)', { skip: skipNoSample }, () => {
  const prep = Retarget.prepare(sampleClip(), Rig);
  let maxU = 0, maxF = 0;
  prep.poses.forEach((p) => {
    Retarget.toJoints(p, Rig).arms.forEach((a) => {
      maxU = Math.max(maxU, Math.hypot(a.E.x - a.S.x, a.E.y - a.S.y));
      maxF = Math.max(maxF, Math.hypot(a.W.x - a.E.x, a.W.y - a.E.y));
    });
  });
  assert.ok(maxU <= Rig.L1 + 1e-6, `upper arm ${maxU} > ${Rig.L1}`);
  assert.ok(maxF <= Rig.L2 + 1e-6, `forearm ${maxF} > ${Rig.L2}`);
  // and the arms still move: the forearm is foreshortened on some frames, near full length on others
  assert.ok(maxF > 0.9 * Rig.L2);
});

test('face region: a fingertip touching the signer\'s nose lands within 3 px of the avatar\'s nose', { skip: skipNoSample }, () => {
  const c = sampleClip();
  const i = c.frames.findIndex((f) => f[2] && f[0]);
  const f = JSON.parse(JSON.stringify(c.frames[i]));
  const nose = f[0][0];
  const tip = f[2][8];
  const dx = nose[0] - tip[0], dy = nose[1] - tip[1];
  f[2] = f[2].map((p) => [p[0] + dx, p[1] + dy, p[2]]);
  const cal = Clip.calibrate(c);
  const head = { rollS: 0, roll: 0, dx: 0 };
  const r = Retarget.retargetFrame(c, cal, Rig, f, head);
  assert.equal(r.face[0], 1);
  r.pose.arms.forEach((a, n) => { if (!a.hand) a.hand = Rig.restHand[n]; });
  const j = Retarget.toJoints(r.pose, Rig);
  const avatarNose = Retarget.avatarNose(Rig, r.pose.head);
  const d = Math.min(...j.arms[0].hand.map((p) => Math.hypot(p.x - avatarNose.x, p.y - avatarNose.y)));
  assert.ok(d <= 3, `fingertip ${d.toFixed(2)} px from the nose`);
  // far from the face: no face mapping
  const far = JSON.parse(JSON.stringify(c.frames[i]));
  far[2] = far[2].map((p) => [p[0], p[1] + 0.3, p[2]]);
  assert.equal(Retarget.retargetFrame(c, cal, Rig, far, head).face[0], 0);
});

test('missing hands: short gaps are interpolated, long gaps ease to the relaxed hand, none -> relaxed hand', { skip: skipNoSample }, () => {
  const c = sampleClip();
  const k = c.frames.findIndex((f, n) => n > 20 && f[2] && c.frames[n + 4] && c.frames[n + 4][2]);
  const gap = JSON.parse(JSON.stringify(c));
  for (let n = k + 1; n <= k + 3; n++) gap.frames[n][2] = null;
  const NS = { smooth: false };   // the gap fill itself, before the temporal smoothing
  const prep = Retarget.prepare(gap, Rig, NS);
  // compared with the same prep's own frames k and k+4 (the palm calibration depends on the frames)
  const a = prep.poses[k].arms[0].hand, b = prep.poses[k + 4].arms[0].hand, m = prep.poses[k + 2].arms[0].hand;
  for (let j = 0; j < 21; j++) {
    assert.ok(Math.abs(m[j].x - (a[j].x + b[j].x) / 2) < 1e-6);
    assert.ok(Math.abs(m[j].y - (a[j].y + b[j].y) / 2) < 1e-6);
  }
  const rest = Rig.restHand[0];
  assert.ok(m.some((p, j) => Math.hypot(p.x - rest[j].x, p.y - rest[j].y) > 5), 'gap filled with the fixed shape');
  // a clip with no hand at all for an arm -> the relaxed hand
  const none = JSON.parse(JSON.stringify(c));
  none.frames.forEach((f) => { f[1] = null; });
  const pn = Retarget.prepare(none, Rig, NS);
  assert.ok(pn.poses[5].arms[1].hand.every((p, j) => Math.hypot(p.x - Rig.restHand[1][j].x, p.y - Rig.restHand[1][j].y) < 1e-9));
  // long gap: the frame right next to the last detected hand still has (almost) that hand
  const long = JSON.parse(JSON.stringify(c));
  for (let n = k + 1; n < k + 30; n++) long.frames[n][2] = null;
  const pl = Retarget.prepare(long, Rig, NS);
  const held = pl.poses[k + 1].arms[0].hand, last = pl.poses[k].arms[0].hand;
  // one frame into a long gap: 1 / (0.3 s * 25 fps) of the way to the relaxed hand, smoothstep-eased
  const u = Retarget.smoothstep(0, 1, 1 / 7.5);
  const rest0 = Rig.restHand[0];
  assert.ok(held.every((p, j) => Math.hypot(p.x - (last[j].x + (rest0[j].x - last[j].x) * u), p.y - (last[j].y + (rest0[j].y - last[j].y) * u)) < 1e-9));
  const mid = pl.poses[k + 15].arms[0].hand;
  assert.ok(mid.every((p, j) => Math.hypot(p.x - Rig.restHand[0][j].x, p.y - Rig.restHand[0][j].y) < 1e-6));
});

function subClip(c, a, b) { return { ...c, frames: c.frames.slice(a, b + 1) }; }

test('timeline: blends are continuous, never dip toward rest, and rest is exact at both ends', { skip: skipNoSample }, () => {
  const c = sampleClip();
  // Three "signs" cut from the sample, played out of order so every boundary is a real jump.
  const preps = [subClip(c, 120, 190), subClip(c, 0, 59), subClip(c, 60, 119)].map((x) => Retarget.prepare(x, Rig));
  const tl = Timeline.build(preps, Rig);
  const restJ = jointsOf(Retarget.restPose(Rig));
  assert.deepEqual(jointsOf(tl.poseAt(0).pose), restJ);
  assert.deepEqual(jointsOf(tl.poseAt(tl.duration).pose), restJ);

  const report = [];
  tl.segments.forEach((s) => {
    if (s.kind === 'clip') return;
    // end/start equality
    assert.ok(maxJump(tl.poseAt(s.t0).pose, s.a) <= 0.5, `${s.kind} ${s.word} start`);
    assert.ok(maxJump(tl.poseAt(s.t1 - 1e-6).pose, s.b) <= 0.5, `${s.kind} ${s.word} end`);
    // per-40ms jumps over the transition: from its first frame (== the previous clip's last frame)
    // until the step that lands in the next clip
    let worst = 0;
    for (let t = s.t0; t < s.t1; t += STEP) {
      worst = Math.max(worst, maxJump(tl.poseAt(Math.max(0, t)).pose, tl.poseAt(Math.min(tl.duration, t + STEP)).pose));
    }
    report.push({ kind: s.kind, word: s.word, worst: +worst.toFixed(1) });
    assert.ok(worst <= JUMP_MAX, `${s.kind} into word ${s.word}: ${worst.toFixed(1)} px per ${STEP} ms`);
    if (s.kind === 'blend') {
      const low = (p) => Math.max(...Retarget.toJoints(p, Rig).arms.map((a) => a.W.y));
      const limit = Math.max(low(s.a), low(s.b)) + 5;
      for (let t = s.t0; t <= s.t1; t += 10) assert.ok(low(tl.poseAt(t).pose) <= limit, `dip at ${t}`);
    }
  });
  tl.segments.filter((x) => x.kind === 'blend').forEach((x) => report.push({ blendMs: x.t1 - x.t0 }));
  console.log('[avatar-math] transition worst jumps (px / 40 ms):', JSON.stringify(report));
  // word index follows the segments
  assert.equal(tl.poseAt(tl.segments[2].t0 + 1).word, 1);
});

test('smoothing: per-40 ms joint jumps inside the sample clip stay below 60 px (p95)', { skip: skipNoSample }, () => {
  const prep = Retarget.prepare(sampleClip(), Rig);
  const jumps = [];
  for (let k = 1; k < prep.poses.length; k++) jumps.push(maxJump(prep.poses[k - 1], prep.poses[k]));
  jumps.sort((a, b) => a - b);
  const p95 = jumps[Math.floor(jumps.length * 0.95)];
  console.log('[avatar-math] within-clip jumps: median', jumps[jumps.length >> 1].toFixed(1), 'p95', p95.toFixed(1), 'max', jumps.at(-1).toFixed(1));
  assert.ok(p95 <= JUMP_MAX);
});

test('timeline: one sign, and the empty list, still start and end at rest', { skip: skipNoSample }, () => {
  const prep = Retarget.prepare(subClip(sampleClip(), 0, 40), Rig);
  const tl = Timeline.build([prep], Rig);
  const rest = Retarget.restPose(Rig);
  assert.equal(tl.duration, Timeline.transitionMs(rest, prep.poses[0], Timeline.IN_MS, Rig) + 40 * 1000 / prep.fps
    + Timeline.transitionMs(prep.poses[40], rest, Timeline.OUT_MS, Rig));
  const restJ = jointsOf(Retarget.restPose(Rig));
  assert.deepEqual(jointsOf(tl.poseAt(tl.duration + 100).pose), restJ);
  const empty = Timeline.build([], Rig);
  assert.equal(empty.duration, 0);
});

test('missing clip fallback: words without a clip become video items, runs stay together', () => {
  const runs = Timeline.splitRuns([
    { item: 'hello', key: 'hello' }, { item: 'how are you', key: 'how_are_you' },
    { item: 'xyz', key: null }, { item: 'my name', key: 'my_name' }, { item: 'abc', key: null },
  ]);
  assert.deepEqual(runs.map((r) => r.type), ['avatar', 'video', 'avatar', 'video']);
  assert.deepEqual(runs[0].items.map((i) => i.key), ['hello', 'how_are_you']);
  assert.equal(runs[1].item, 'xyz');
  assert.deepEqual(Timeline.splitRuns([{ item: 'a', key: null }]), [{ type: 'video', item: 'a' }]);
});

test('rest pose: hands in front of the waist, elbows outside the shoulders, all inside the kiosk view', () => {
  const j = Retarget.toJoints(Retarget.restPose(Rig), Rig);
  assert.ok(j.arms[0].E.x < j.arms[0].S.x && j.arms[1].E.x > j.arms[1].S.x);
  j.arms.forEach((a, i) => assert.ok(Math.abs(a.W.y - (Rig.sockets[i].y + Rig.restWristOffset[i].y)) < 1));
  // every rest-pose point is inside the kiosk panel's view
  const v = Rig.views.kiosk;
  j.arms.forEach((a) => [a.S, a.E, a.W, ...a.hand].forEach((p) => assert.ok(p.y < v.y + v.h && p.x > v.x && p.x < v.x + v.w)));
});

test('face region with a tilted signer head: the contact point is still exact', { skip: skipNoSample }, () => {
  const c = sampleClip();
  const i = c.frames.findIndex((f) => f[2] && f[0]);
  const f = JSON.parse(JSON.stringify(c.frames[i]));
  const nose = f[0][0], tip = f[2][8];
  f[2] = f[2].map((p) => [p[0] + nose[0] - tip[0], p[1] + nose[1] - tip[1], p[2]]);
  const cal = Clip.calibrate(c);
  for (const head of [{ rollS: 0.3, roll: 0.15, dx: 0 }, { rollS: -0.35, roll: -0.15, dx: 10 }]) {
    const r = Retarget.retargetFrame(c, cal, Rig, f, head);
    r.pose.arms.forEach((a, n) => { if (!a.hand) a.hand = Rig.restHand[n]; });
    const j = Retarget.toJoints(r.pose, Rig);
    const an = Retarget.avatarNose(Rig, r.pose.head);
    const d = Math.min(...j.arms[0].hand.map((p) => Math.hypot(p.x - an.x, p.y - an.y)));
    assert.ok(d <= 3, `tilt ${head.rollS}: ${d.toFixed(2)} px`);
  }
});

test('IK: the elbow bends to the requested side; lengths grow only up to L1/L2', () => {
  const S = { x: 400, y: 340 }, T = { x: 520, y: 300 };
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  for (const side of [1, -1]) {
    const r = Retarget.solveIK(S, T, 100, 90, side, 128, 120);
    assert.equal(Math.sign(cross({ x: T.x - S.x, y: T.y - S.y }, { x: r.E.x - S.x, y: r.E.y - S.y })), side);
    assert.ok(Math.abs(Math.hypot(r.E.x - S.x, r.E.y - S.y) - 100) < 1e-6);
  }
  const far = Retarget.solveIK(S, { x: 900, y: 340 }, 100, 90, 1, 128, 120);
  assert.ok(Math.hypot(far.E.x - S.x, far.E.y - S.y) <= 128 + 1e-6);
  assert.ok(Math.hypot(far.W.x - far.E.x, far.W.y - far.E.y) <= 120 + 1e-6);
});

test('angles: lerp and smoothing go the short way across +-pi', () => {
  const rest = Retarget.restPose(Rig);
  const a = Retarget.lerpPose(rest, rest, 0), b = Retarget.lerpPose(rest, rest, 0);
  a.arms[0].au = Math.PI - 0.01; b.arms[0].au = -Math.PI + 0.01;
  const m = Retarget.lerpPose(a, b, 0.5).arms[0].au;
  assert.ok(Math.abs(Math.abs(m) - Math.PI) < 1e-9);
  const seq = [a, b, a, b, a].map((p) => Retarget.lerpPose(p, p, 0));
  Retarget.smoothPoses(seq).forEach((p) => assert.ok(Math.abs(Math.cos(p.arms[0].au) + 1) < 1e-3, 'smoothed angle near pi'));
});

test('validateClip: poseIdx, visibility, coordinate bounds, trim order; calibrate rejects zero shoulders', { skip: skipNoSample }, () => {
  const c = sampleClip();
  assert.equal(Clip.validateClip({ ...c, poseIdx: [0, 1] }).ok, false);
  assert.equal(Clip.validateClip({ ...c, trim: { startMs: 9, endMs: 1 } }).ok, false);
  const vis = JSON.parse(JSON.stringify(c)); vis.frames[0][0][0][3] = 1.5;
  assert.equal(Clip.validateClip(vis).ok, false);
  const big = JSON.parse(JSON.stringify(c)); big.frames[0][0][0][0] = 1e9;
  assert.equal(Clip.validateClip(big).ok, false);
  const flat = JSON.parse(JSON.stringify(c));
  flat.frames.forEach((f) => { if (f[0]) f[0][Clip.P.shR] = f[0][Clip.P.shL].slice(); });
  assert.throws(() => Clip.calibrate(flat), /shoulder/);
});
