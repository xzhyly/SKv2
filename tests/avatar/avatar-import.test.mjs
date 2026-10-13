// Import JSON (2026-10-13): AvatarClip.importClip(), the pure part of avatar-clips.html's
// "Import JSON". Synthetic data throughout; the owner's prototype sample is used too when it is on
// this machine (it is not shipped in the repo).
// Run: node --test tests/avatar/avatar-import.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Clip, SAMPLE_JSON, haveSample } from './helper.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clone = (x) => JSON.parse(JSON.stringify(x));

// One prototype frame: 11 pose points [x, y, z, visibility] and two hands of 21 [x, y, z], 4 decimals.
function protoFrame(i, hands = true) {
  const pose = Clip.POSE_IDX.map((_, j) => [0.1234 + j * 0.01, 0.2345 + i * 0.0011, -0.5678, 0.987]);
  pose[Clip.P.shL][0] = 0.7; pose[Clip.P.shR][0] = 0.3;   // a shoulder width for calibrate()
  const hand = () => Array.from({ length: 21 }, (_, j) => [0.4321 + j * 0.001, 0.5432, -0.0123]);
  return { t: i * 40, pose, lh: hands ? hand() : null, rh: hands ? hand() : null };
}
function proto(n = 10) {
  return { format: 'avatar_pose_hands_v1', source: 'x.mp4', fps: 25, w: 1080, h: 1920, poseIdx: Clip.POSE_IDX.slice(),
    frames: Array.from({ length: n }, (_, i) => protoFrame(i, i % 2 === 0)) };
}
// What Save builds from an import: every frame kept.
function build(res, key = 'zz_x') {
  return Clip.buildClip({ key, fps: res.fps, video: res.video, frames: res.frames, trim: { start: 0, end: res.frames.length - 1 }, signer: res.signer });
}

test('prototype file -> stored frame layout, 3-decimal coordinates, 2-decimal visibility, same fps', () => {
  const res = Clip.importClip(proto(10));
  assert.equal(res.ok, true);
  assert.equal(res.source, 'prototype');
  assert.equal(res.fps, 25);
  assert.deepEqual(res.video, { w: 1080, h: 1920, durationMs: 400 });
  assert.equal(res.frames.length, 10);
  assert.equal(res.offsetMs, 0);
  const f = res.frames[0];
  assert.equal(f.length, 3);
  assert.deepEqual(f[0][0], [0.123, 0.235, -0.568, 0.99]);
  assert.deepEqual(f[1][0], [0.432, 0.543, -0.012]);
  assert.deepEqual(res.frames[1], [res.frames[1][0], null, null]);
  const clip = build(res);
  assert.deepEqual(Clip.validateClip(clip), { ok: true });
  assert.equal(JSON.stringify(clip).includes('x.mp4'), false);   // the source video's name is not kept
});

test('prototype file: a signer is carried, the file\'s own key is not', () => {
  const p = proto(3);
  p.signer = 'P03'; p.key = 'something_else';
  const res = Clip.importClip(p);
  assert.equal(res.signer, 'P03');
  assert.equal('key' in res, false);
  assert.equal(Clip.importClip(proto(3)).signer, '');
});

test('system clip: frames kept exactly; export -> import -> build gives the same frames and trim', () => {
  const first = Clip.buildClip({ key: 'zz_a', fps: 25, video: { w: 1080, h: 1920, durationMs: 4000 },
    frames: Clip.importClip(proto(40)).frames, trim: { start: 5, end: 30, auto: true }, signer: 'P03' });
  const exported = JSON.parse(JSON.stringify(first));           // what Export JSON downloads
  const res = Clip.importClip(exported);
  assert.equal(res.ok, true);
  assert.equal(res.source, 'clip');
  assert.equal(res.signer, 'P03');
  assert.equal(res.frames.length, 26);
  assert.deepEqual(res.frames, first.frames);
  assert.equal(res.offsetMs, first.trim.startMs);
  const again = build(res, 'zz_b');
  assert.equal(JSON.stringify(again.frames), JSON.stringify(first.frames));
  assert.equal(again.key, 'zz_b');
  assert.equal(again.trim.startMs + res.offsetMs, first.trim.startMs);
  assert.equal(again.trim.endMs + res.offsetMs, first.trim.endMs);
});

test('rejected: not an object, another shape, a recognition sample', () => {
  for (const bad of [null, 5, 'text', [], [1, 2]]) assert.equal(Clip.importClip(bad).ok, false);
  const other = Clip.importClip({ hello: 'world', frames: [] });
  assert.equal(other.ok, false);
  assert.match(other.error, /not an avatar clip/);
  assert.match(other.error, /no format field/);
  const dirs = readdirSync(path.join(repo, 'saved_gestures'));
  const d = dirs.find((x) => readdirSync(path.join(repo, 'saved_gestures', x)).some((f) => /^sample_.*\.json$/.test(f)));
  const sampleFile = readdirSync(path.join(repo, 'saved_gestures', d)).find((f) => /^sample_.*\.json$/.test(f));
  const sample = Clip.importClip(JSON.parse(readFileSync(path.join(repo, 'saved_gestures', d, sampleFile), 'utf8')));
  assert.equal(sample.ok, false);
  assert.match(sample.error, /not an avatar clip/);
  assert.match(sample.error, /recognition sample/);
});

test('rejected: a system clip that fails validateClip', () => {
  const good = build(Clip.importClip(proto(6)));
  const cases = [
    (c) => { c.frames[2][0][3] = [0.1, 0.2]; },
    (c) => { c.frames = []; },
    (c) => { c.poseIdx = [0, 1, 2]; },
    (c) => { delete c.video; },
    (c) => { c.fps = 0; },
    (c) => { c.signer = 'x'.repeat(81); },
    (c) => { c.frames = Array.from({ length: Clip.MAX_FRAMES + 1 }, () => c.frames[0]); },
  ];
  for (const mutate of cases) {
    const c = clone(good);
    mutate(c);
    const res = Clip.importClip(c);
    assert.equal(res.ok, false, mutate.toString());
    assert.match(res.error, /not valid/);
  }
});

test('rejected: a malformed prototype file', () => {
  const cases = [
    (p) => { p.frames[1].pose = p.frames[1].pose.slice(0, 10); },
    (p) => { p.frames[0].lh[4] = [0.1, 'a', 0.3]; },
    (p) => { p.frames[0].rh = {}; },
    (p) => { p.frames[3] = [null, null, null]; },
    (p) => { p.frames.forEach((f) => { f.pose = null; }); },
    (p) => { p.frames = []; },
    (p) => { delete p.frames; },
    (p) => { p.poseIdx = [0, 7, 8]; },
    (p) => { p.fps = 500; },
    (p) => { delete p.w; },
    (p) => { p.frames = Array.from({ length: Clip.MAX_IMPORT_FRAMES + 1 }, () => p.frames[0]); },
  ];
  for (const mutate of cases) {
    const p = proto(6);
    mutate(p);
    const res = Clip.importClip(p);
    assert.equal(res.ok, false, mutate.toString());
    assert.match(res.error, /avatar_pose_hands_v1 file is not valid/);
  }
});

test('the owner\'s prototype sample imports, auto-trims and validates', { skip: !haveSample }, () => {
  const data = JSON.parse(readFileSync(SAMPLE_JSON, 'utf8'));
  const res = Clip.importClip(data);
  assert.equal(res.ok, true);
  assert.equal(res.frames.length, data.frames.length);
  const t = Clip.autoTrim(res.frames);
  assert.ok(t && t.end > t.start);
  const clip = Clip.buildClip({ key: 'zz_x', fps: res.fps, video: res.video, frames: res.frames, trim: { ...t, auto: true } });
  assert.deepEqual(Clip.validateClip(clip), { ok: true });
  // every stored number has at most 3 decimals (2 for visibility): rounding it again changes nothing
  const r = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
  for (const f of clip.frames) {
    for (const p of f[0] || []) assert.deepEqual(p, [r(p[0], 3), r(p[1], 3), r(p[2], 3), r(p[3], 2)]);
    for (const h of [f[1], f[2]]) for (const p of h || []) assert.deepEqual(p, p.map((n) => r(n, 3)));
  }
  // within half a unit of the last kept decimal of the prototype's 4-decimal values
  let worst = 0;
  res.frames.forEach((f, i) => { if (f[0]) f[0].forEach((p, j) => { for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p[k] - data.frames[i].pose[j][k])); }); });
  assert.ok(worst <= 0.0005 + 1e-9, String(worst));
});
