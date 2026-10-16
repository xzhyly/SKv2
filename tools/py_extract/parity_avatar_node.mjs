// tools/py_extract/parity_avatar_node.mjs
// For tools/py_extract/parity_avatar.py: measures a browser and a python avatar candidate of the
// same video with the page's own avatar code (js/avatar-clip.js, avatar-retarget.js,
// avatar-timeline.js, avatar-rig.js; tests/avatar/helper.mjs jointsOf / maxJump), so the
// comparison never uses a second copy of the retarget or the timeline.
// stdin: a JSON list of {browser: <candidate file>, python: <candidate file>}
//   (bulk_import_cache/candidates/<key>/<SIGNER>.json: {videoId, repIndex, savedAt, set, clip}).
// stdout: one JSON answer per pair, in order:
//   {browser: m, python: m, joints: {frames, onlyOne, meanPx, meanSigma, perJoint: {name: sigma}}}
//   m = {frames, startMs, endMs, valid, continuity: {transitions, body}, forearm: {avatar, signer}}
//   continuity: the worst joint movement (logical px) over any 40 ms window, 5 ms apart, of the
//     clip played alone (rest -> clip -> rest, AvatarTimeline.build): over the windows that overlap
//     a transition (the repo's check, limit 60: tests/avatar/avatar-edges.test.mjs) and over the
//     clip itself (its own movement; shown only).
//   forearm: frame-to-frame forearm angle changes over 90 degrees, both arms:
//     avatar = the retargeted pose as it is drawn (AvatarRetarget.prepare(), param af);
//     signer = the raw pose (elbow -> wrist in video pixels), before any retargeting.
//     {count, maxDeg}
//   joints: shoulders, elbows and wrists of the two clips on their common grid frames (the clip's
//     frame i is grid frame trim.startMs * fps / 1000 + i), both with a pose; distance in video
//     pixels, and in shoulder widths (sigma = AvatarClip.calibrate() of the browser clip).
import fs from 'node:fs';
import { Rig, Clip, Retarget, Timeline, maxJump } from '../../tests/avatar/helper.mjs';

const LIMIT = 60;
const STEP_MS = 5;
const JOINTS = { shL: Clip.P.shL, shR: Clip.P.shR, elL: Clip.P.elL, elR: Clip.P.elR, wrL: Clip.P.wrL, wrR: Clip.P.wrR };
const deg = (r) => r * 180 / Math.PI;
function wrap(d) {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function continuity(prep) {
  const tl = Timeline.build([prep], Rig);
  let transitions = 0, body = 0;
  for (const s of tl.segments) {
    for (let t = s.t0 - 40; t < s.t1; t += STEP_MS) {
      const a = Math.max(0, t), b = Math.min(tl.duration, t + 40);
      const j = maxJump(tl.poseAt(a).pose, tl.poseAt(b).pose);
      if (s.kind === 'clip') body = Math.max(body, j);
      else transitions = Math.max(transitions, j);
    }
  }
  return { transitions: +transitions.toFixed(1), body: +body.toFixed(1), limit: LIMIT };
}

function jumps(series) {
  let count = 0, max = 0;
  for (const s of series) {
    for (let i = 1; i < s.length; i++) {
      if (s[i] === null || s[i - 1] === null) continue;
      const d = Math.abs(deg(wrap(s[i] - s[i - 1])));
      max = Math.max(max, d);
      if (d > 90) count++;
    }
  }
  return { count, maxDeg: +max.toFixed(1) };
}

function measure(clip) {
  const v = Clip.validateClip(clip);
  const out = { frames: clip.frames.length, startMs: clip.trim.startMs, endMs: clip.trim.endMs, valid: v.ok ? true : v.error };
  if (!v.ok) return out;
  const prep = Retarget.prepare(clip, Rig);
  out.continuity = continuity(prep);
  const avatar = [0, 1].map((i) => prep.poses.map((p) => p.arms[i].af));
  const signer = Clip.ARMS.map((a) => clip.frames.map((f) => {
    if (!f[0]) return null;
    const E = Clip.px(clip, f[0][a.E]), W = Clip.px(clip, f[0][a.W]);
    return Math.atan2(W.y - E.y, W.x - E.x);
  }));
  out.forearm = { avatar: jumps(avatar), signer: jumps(signer) };
  return out;
}

function joints(b, p) {
  const gb = Math.round(b.trim.startMs * b.fps / 1000), gp = Math.round(p.trim.startMs * p.fps / 1000);
  let sigma = NaN;
  try { sigma = Clip.calibrate(b).sigma; } catch (e) { /* no shoulder width */ }
  const sum = {}, n = {};
  Object.keys(JOINTS).forEach((k) => { sum[k] = 0; n[k] = 0; });
  let common = 0, onlyOne = 0, all = 0, allN = 0;
  for (let i = 0; i < b.frames.length; i++) {
    const j = gb + i - gp;
    if (j < 0 || j >= p.frames.length) continue;
    common++;
    const fb = b.frames[i][0], fp = p.frames[j][0];
    if (!fb || !fp) { if (fb || fp) onlyOne++; continue; }
    for (const [k, idx] of Object.entries(JOINTS)) {
      const d = Math.hypot((fb[idx][0] - fp[idx][0]) * b.video.w, (fb[idx][1] - fp[idx][1]) * b.video.h);
      sum[k] += d; n[k]++; all += d; allN++;
    }
  }
  const perJoint = {};
  Object.keys(JOINTS).forEach((k) => { perJoint[k] = n[k] ? +(sum[k] / n[k] / sigma).toFixed(4) : null; });
  return {
    frames: common, compared: allN / 6, onlyOne,
    meanPx: allN ? +(all / allN).toFixed(2) : null,
    sigmaPx: isFinite(sigma) ? +sigma.toFixed(1) : null,
    meanSigma: allN && isFinite(sigma) ? +(all / allN / sigma).toFixed(4) : null,
    perJoint,
  };
}

const pairs = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(pairs.map((q) => {
  const b = JSON.parse(fs.readFileSync(q.browser, 'utf8')).clip;
  const p = JSON.parse(fs.readFileSync(q.python, 'utf8')).clip;
  return { browser: measure(b), python: measure(p), joints: joints(b, p) };
})));
