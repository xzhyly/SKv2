// Cleanup 2026-10-20: the forearm direction stabilizer and the per-frame hand side
// (js/avatar-retarget.js stabilizeForearms / handsOf). Synthetic clips only.
// Run: node --test tests/avatar/avatar-forearm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rig, Clip, Retarget } from './helper.mjs';

const wrap = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const arm = (af, kf, hand = null) => ({ au: 0, ku: 1, af, kf, z: 0, shrug: 0, hand });
const pose = (a0, a1) => ({ arms: [a0, a1 || arm(0, 1)], head: { roll: 0, dx: 0 } });

test('a short forearm keeps the previous direction; no turn over 45 degrees per 40 ms', () => {
  const poses = [pose(arm(-1.6, 0.9)), pose(arm(-1.7, 0.8)), pose(arm(-1.8, 0.6)), pose(arm(1.2, 0.15)), pose(arm(-0.2, 0.1))];
  Retarget.stabilizeForearms(poses, 25);
  for (let i = 1; i < poses.length; i++) assert.ok(Math.abs(wrap(poses[i].arms[0].af - poses[i - 1].arms[0].af)) <= Math.PI / 4 + 1e-9, 'frame ' + i);
  assert.ok(Math.abs(wrap(poses[4].arms[0].af - poses[2].arms[0].af)) < 0.01);
});

test('a 180-degree flip on a short forearm resolves toward the previous frame', () => {
  const poses = [pose(arm(-1.5, 0.9)), pose(arm(-1.5 + Math.PI - 0.1, 0.4))];
  Retarget.stabilizeForearms(poses, 25);
  assert.ok(Math.abs(wrap(poses[1].arms[0].af + 1.5)) < 0.2, String(poses[1].arms[0].af));
});

test('a turned forearm keeps its hand where it was drawn', () => {
  const hand = Array.from({ length: 21 }, (_, j) => ({ x: 10 + j, y: j % 3, z: 0 }));
  const poses = [pose(arm(-1.5, 0.9)), pose(arm(1.0, 0.1, hand))];
  const before = hand.map((p) => { const c = Math.cos(1.0), s = Math.sin(1.0); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; });
  Retarget.stabilizeForearms(poses, 25);
  const a = poses[1].arms[0], c = Math.cos(a.af), s = Math.sin(a.af);
  a.hand.forEach((p, j) => {
    assert.ok(Math.abs(p.x * c - p.y * s - before[j].x) < 1e-6 && Math.abs(p.x * s + p.y * c - before[j].y) < 1e-6);
  });
});

test('hands labelled the other way round are given to the arm whose pose wrist they are at', () => {
  const P = Clip.P;
  const p = Array.from({ length: 11 }, () => [0.5, 0.5, 0, 1]);
  p[P.shR] = [0.4, 0.3, 0, 1]; p[P.shL] = [0.6, 0.3, 0, 1];
  p[P.elR] = [0.38, 0.45, 0, 1]; p[P.elL] = [0.62, 0.45, 0, 1];
  p[P.wrR] = [0.36, 0.3, 0, 1]; p[P.wrL] = [0.64, 0.3, 0, 1];
  p[P.hipR] = [0.45, 0.8, 0, 1]; p[P.hipL] = [0.55, 0.8, 0, 1];
  p[P.nose] = [0.5, 0.15, 0, 1]; p[P.earR] = [0.47, 0.15, 0, 1]; p[P.earL] = [0.53, 0.15, 0, 1];
  const handAt = (x, y) => Array.from({ length: 21 }, (_, j) => [x + j * 0.002, y - j * 0.003, 0]);
  const right = handAt(0.36, 0.3), left = handAt(0.64, 0.3);
  const clip = { fps: 25, video: { w: 1000, h: 1000 }, frames: [[p, left, right], [p, right, left], [p, right, null]] };
  const cal = Clip.calibrate(clip);
  const head = { roll: 0, rollS: 0, dx: 0 };
  const W = (f) => Retarget.toJoints(Retarget.retargetFrame(clip, cal, Rig, clip.frames[f], head).pose, Rig).arms.map((a) => a.W.x);
  const ok = W(0);
  assert.deepEqual(W(1), ok);                  // both labels swapped: same avatar pose
  const one = Retarget.retargetFrame(clip, cal, Rig, clip.frames[2], head);
  assert.deepEqual(one.detected, [true, false]); // the right hand labelled "left" goes to arm 0
});
