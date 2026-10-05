// Shared helpers for tests/avatar: loads the pure avatar modules (plain scripts with a node
// module.exports branch) and the owner's sample clip (prototype output, NOT shipped in the repo:
// docs/reports/2026-10-05-avatar-step1.md Q12), converted to the sk_avatar_clip_v1 frame layout.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
export const Rig = require('../../js/avatar-rig.js');
export const Clip = require('../../js/avatar-clip.js');
export const Retarget = require('../../js/avatar-retarget.js');
export const Timeline = require('../../js/avatar-timeline.js');

export const SAMPLE_DIR = 'C:/Users/ADMIN/Downloads/Avatar';
export const SAMPLE_JSON = SAMPLE_DIR + '/my_name_is.avatar.json';
export const SAMPLE_MP4 = SAMPLE_DIR + '/my_name_is.mp4';
export const haveSample = existsSync(SAMPLE_JSON);

// Prototype output ({t, pose, lh, rh} objects, 4 decimals) -> all frames as [pose, lh, rh].
export function sampleFrames() {
  const d = JSON.parse(readFileSync(SAMPLE_JSON, 'utf8'));
  return { meta: d, frames: d.frames.map((f) => [f.pose, f.lh, f.rh]) };
}

export function sampleClip(trim) {
  const { meta, frames } = sampleFrames();
  const t = trim || Clip.autoTrim(frames);
  return Clip.buildClip({
    key: 'zz_sample',
    fps: meta.fps,
    video: { w: meta.w, h: meta.h, durationMs: frames.length * 1000 / meta.fps },
    frames,
    trim: { start: t.start, end: t.end, auto: !trim },
    createdAt: '2026-10-05T00:00:00Z',
  });
}

// Every drawn joint of a param pose: shoulders, elbows, wrists and both hands' 21 points.
export function jointsOf(pose) {
  const j = Retarget.toJoints(pose, Rig);
  const pts = [];
  j.arms.forEach((a) => { pts.push(a.S, a.E, a.W, ...a.hand); });
  return pts;
}

export function maxJump(p, q) {
  const a = jointsOf(p), b = jointsOf(q);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
  return m;
}
