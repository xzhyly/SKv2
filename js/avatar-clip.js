// js/avatar-clip.js
// The avatar clip format (sk_avatar_clip_v1, docs/reports/2026-10-05-avatar-step1.md (c)):
// build, validate, auto-trim and per-clip calibration. A clip is RAW MediaPipe Holistic landmarks
// in signer space (normalized image coordinates); retargeting to the avatar happens at play time
// (js/avatar-retarget.js), so improving that math never needs a re-extraction.
// Pure: no DOM. Attaches window.AvatarClip, and module.exports under node.
(function () {
  'use strict';

  var FORMAT = 'sk_avatar_clip_v1';
  // nose, left ear, right ear, shoulders L/R, elbows L/R, wrists L/R, hips L/R (avatar_extract.html)
  var POSE_IDX = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24];
  var P = { nose: 0, earL: 1, earR: 2, shL: 3, shR: 4, elL: 5, elR: 6, wrL: 7, wrR: 8, hipL: 9, hipR: 10 };
  // Arm 0 = the signer's right arm (viewer's left), arm 1 = the signer's left arm.
  var ARMS = [
    { S: P.shR, E: P.elR, W: P.wrR, hand: 2 },   // frame[2] = right hand
    { S: P.shL, E: P.elL, W: P.wrL, hand: 1 }    // frame[1] = left hand
  ];
  var MAX_FRAMES = 500;   // 20 s at 25 fps
  var MIN_UP_RUN = 3;     // auto-trim: a hand must be up for at least 3 consecutive frames

  function r(n, dp) { var m = Math.pow(10, dp); return Math.round(n * m) / m; }

  // Holistic results -> one stored frame [pose|null, leftHand|null, rightHand|null].
  function packFrame(results) {
    results = results || {};
    var pose = null;
    if (results.poseLandmarks) {
      pose = POSE_IDX.map(function (j) {
        var p = results.poseLandmarks[j];
        return [r(p.x, 3), r(p.y, 3), r(p.z, 3), r(p.visibility || 0, 2)];
      });
    }
    function hand(list) {
      if (!list) return null;
      return list.map(function (p) { return [r(p.x, 3), r(p.y, 3), r(p.z, 3)]; });
    }
    return [pose, hand(results.leftHandLandmarks), hand(results.rightHandLandmarks)];
  }

  // A wrist is "up" when it is above shoulderY + 0.6 * (hipY - shoulderY).
  function handUp(frame) {
    var pose = frame && frame[0];
    if (!pose) return false;
    var sy = (pose[P.shL][1] + pose[P.shR][1]) / 2;
    var hy = (pose[P.hipL][1] + pose[P.hipR][1]) / 2;
    var line = sy + 0.6 * (hy - sy);
    return pose[P.wrL][1] < line || pose[P.wrR][1] < line;
  }

  // First frame of the first run of >= MIN_UP_RUN "up" frames .. last frame of the last such run.
  // Returns {start, end} (inclusive frame indices) or null when no hand is ever raised.
  function autoTrim(frames) {
    var start = -1, end = -1, run = 0;
    for (var i = 0; i < frames.length; i++) {
      if (handUp(frames[i])) {
        run++;
        if (run === MIN_UP_RUN) {
          if (start < 0) start = i - MIN_UP_RUN + 1;
          end = i;
        } else if (run > MIN_UP_RUN) {
          end = i;
        }
      } else {
        run = 0;
      }
    }
    return start < 0 ? null : { start: start, end: end };
  }

  // opts: {key, fps, video:{w,h,durationMs}, frames (all extracted frames), trim:{start,end,auto},
  //        signer, createdAt}. Keeps only frames start..end.
  function buildClip(opts) {
    var trim = opts.trim;
    var fps = opts.fps;
    return {
      format: FORMAT,
      key: opts.key,
      fps: fps,
      video: { w: opts.video.w, h: opts.video.h, durationMs: Math.round(opts.video.durationMs) },
      trim: { startMs: Math.round(trim.start * 1000 / fps), endMs: Math.round(trim.end * 1000 / fps), auto: !!trim.auto },
      extractor: { lib: '@mediapipe/holistic 0.5.1675471629', modelComplexity: 1 },
      signer: String(opts.signer || '').slice(0, 80),
      createdAt: opts.createdAt || new Date().toISOString(),
      poseIdx: POSE_IDX.slice(),
      frames: opts.frames.slice(trim.start, trim.end + 1)
    };
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function pointsOk(list, count, width) {
    if (list === null) return true;
    if (!Array.isArray(list) || list.length !== count) return false;
    for (var i = 0; i < count; i++) {
      var p = list[i];
      if (!Array.isArray(p) || p.length !== width) return false;
      for (var k = 0; k < width; k++) if (!isNum(p[k]) || Math.abs(p[k]) > 100) return false;
      if (width === 4 && (p[3] < 0 || p[3] > 1)) return false;   // pose visibility
    }
    return true;
  }

  // -> {ok:true} or {ok:false, error}
  function validateClip(c) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'not an object' };
    if (c.format !== FORMAT) return { ok: false, error: 'format must be ' + FORMAT };
    if (typeof c.key !== 'string' || !c.key) return { ok: false, error: 'key missing' };
    if (!isNum(c.fps) || c.fps < 1 || c.fps > 60) return { ok: false, error: 'fps out of range' };
    if (!c.video || !isNum(c.video.w) || !isNum(c.video.h) || c.video.w <= 0 || c.video.h <= 0) {
      return { ok: false, error: 'video size missing' };
    }
    if (!Array.isArray(c.poseIdx) || c.poseIdx.join(',') !== POSE_IDX.join(',')) {
      return { ok: false, error: 'poseIdx must be the standard 11 points' };
    }
    if (!c.trim || !isNum(c.trim.startMs) || !isNum(c.trim.endMs) || c.trim.startMs < 0 || c.trim.startMs > c.trim.endMs) {
      return { ok: false, error: 'trim must have 0 <= startMs <= endMs' };
    }
    if (c.signer !== undefined && (typeof c.signer !== 'string' || c.signer.length > 80)) {
      return { ok: false, error: 'signer must be text of at most 80 characters' };
    }
    if (!Array.isArray(c.frames) || c.frames.length < 1) return { ok: false, error: 'no frames' };
    if (c.frames.length > MAX_FRAMES) return { ok: false, error: 'more than ' + MAX_FRAMES + ' frames' };
    var poses = 0;
    for (var i = 0; i < c.frames.length; i++) {
      var f = c.frames[i];
      if (!Array.isArray(f) || f.length !== 3) return { ok: false, error: 'frame ' + i + ' is not [pose, lh, rh]' };
      if (!pointsOk(f[0], POSE_IDX.length, 4)) return { ok: false, error: 'frame ' + i + ' pose malformed' };
      if (!pointsOk(f[1], 21, 3) || !pointsOk(f[2], 21, 3)) return { ok: false, error: 'frame ' + i + ' hand malformed' };
      if (f[0]) poses++;
    }
    if (!poses) return { ok: false, error: 'no frame has a pose' };
    return { ok: true };
  }

  function median(a) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function pct(a, q) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  // Signer-pixel point of a stored landmark.
  function px(clip, p) { return { x: p[0] * clip.video.w, y: p[1] * clip.video.h, z: p[2] * clip.video.w }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Per-clip calibration (step 1 report (d)): shoulder width sigma, true bone lengths U/F (p95 of
  // the 2D length, floored by 0.85/0.65 sigma), ear width eps, palm length, median shoulder heights.
  function calibrate(clip) {
    var sw = [], up = [], fo = [], ears = [], palms = [], shY = [[], []];
    clip.frames.forEach(function (f) {
      var pose = f[0];
      if (pose) {
        sw.push(dist(px(clip, pose[P.shL]), px(clip, pose[P.shR])));
        ears.push(dist(px(clip, pose[P.earL]), px(clip, pose[P.earR])));
        ARMS.forEach(function (a, i) {
          var S = px(clip, pose[a.S]), E = px(clip, pose[a.E]), W = px(clip, pose[a.W]);
          up.push(dist(S, E));
          fo.push(dist(E, W));
          shY[i].push(S.y);
        });
      }
      [f[1], f[2]].forEach(function (h) { if (h) palms.push(dist(px(clip, h[0]), px(clip, h[9]))); });
    });
    var sigma = median(sw);
    if (!(isFinite(sigma) && sigma > 0)) throw new Error('clip has no shoulder width');
    var eps = median(ears);
    var palm = palms.length ? pct(palms, 0.95) : 0.23 * sigma;
    return {
      sigma: sigma,
      U: Math.max(pct(up, 0.95), 0.85 * sigma),
      F: Math.max(pct(fo, 0.95), 0.65 * sigma),
      eps: isFinite(eps) && eps > 0 ? eps : 0.43 * sigma,
      palm: palm,
      shoulderY: [median(shY[0]), median(shY[1])]
    };
  }

  var api = {
    FORMAT: FORMAT,
    POSE_IDX: POSE_IDX,
    P: P,
    ARMS: ARMS,
    MAX_FRAMES: MAX_FRAMES,
    packFrame: packFrame,
    handUp: handUp,
    autoTrim: autoTrim,
    buildClip: buildClip,
    validateClip: validateClip,
    calibrate: calibrate,
    px: px,
    median: median
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AvatarClip = api;
})();
