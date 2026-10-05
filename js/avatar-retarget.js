// js/avatar-retarget.js
// Signer-space clip frames -> avatar "param poses" (docs/reports/2026-10-05-avatar-step1.md (d)).
// A param pose is what the timeline blends and the renderer draws:
//   { arms: [ { au, ku, af, kf, z, shrug, hand: [21 x {x,y,z}] }, x2 ], head: { roll, dx } }
//   au/af = upper-arm / forearm angle (radians, canvas y down), ku/kf = 2D foreshortening (<= 1),
//   z = the pose wrist's depth (draw order: larger = farther, drawn first), shrug = vertical shoulder
//   offset, hand = the 21 hand points in the forearm-local frame (x along the forearm).
// Bones always have the avatar's own lengths (L1/L2) times the signer's foreshortening, so arms are
// never stretched; hands near the face are placed relative to the caricature's face; missing hands
// are filled from neighbouring frames instead of a fixed shape. Pure: no DOM.
(function () {
  'use strict';

  var Clip = (typeof module !== 'undefined' && module.exports) ? require('./avatar-clip.js') : window.AvatarClip;

  var GAP_INTERP = 8;      // frames: hand dropouts up to this long are interpolated
  var REST_EASE_S = 0.3;   // longer gaps ease toward the relaxed hand over this many seconds
  var ROLL_MAX = 0.15;
  var DX_MAX = 20;
  var SHRUG_MAX = 12;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
  function len(a) { return Math.hypot(a.x, a.y); }
  function unit(a) { var l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
  function rot(a, ang) { var c = Math.cos(ang), s = Math.sin(ang); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; }
  function cross(a, b) { return a.x * b.y - a.y * b.x; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function lerpAngle(a, b, u) {
    var d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * u;
  }

  // Two-bone IK from S to T with bone lengths a, b. sideSign: the sign cross(T - S, E - S) must have
  // (0 = prefer the outward elbow, away from x=512). maxA/maxB: lengths may grow up to these to reach.
  function solveIK(S, T, a, b, sideSign, maxA, maxB) {
    var v = sub(T, S);
    var d = len(v);
    if (d > a + b && (maxA > a || maxB > b)) {
      var f = Math.min(d / (a + b), maxA / a, maxB / b);
      a *= f; b *= f;
    }
    if (d > a + b - 0.01) { d = a + b - 0.01; T = add(S, mul(unit(v), d)); }
    var minD = Math.abs(a - b) + 1;
    if (d < minD) { d = minD; T = add(S, mul(unit(v.x || v.y ? v : { x: 0, y: 1 }), d)); }
    var base = Math.atan2(T.y - S.y, T.x - S.x);
    var A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    var best = null, bestScore = -Infinity;
    [1, -1].forEach(function (s) {
      var E = { x: S.x + a * Math.cos(base + s * A), y: S.y + a * Math.sin(base + s * A) };
      var score = sideSign ? Math.sign(cross(sub(T, S), sub(E, S))) * sideSign : Math.abs(E.x - 512);
      if (score > bestScore) { bestScore = score; best = E; }
    });
    return { E: best, W: T };
  }

  // The avatar's rest pose: arms down by the torso, relaxed hands.
  function restPose(rig) {
    var arms = [0, 1].map(function (i) {
      var S = rig.pivot(i, 0);
      var T = add(rig.sockets[i], rig.restWristOffset[i]);
      var ik = solveIK(S, T, rig.L1, rig.L2, 0, rig.L1, rig.L2);
      return paramArm(S, ik.E, ik.W, rig, 0, 0, rig.restHand[i]);
    });
    return { arms: arms, head: { roll: 0, dx: 0 } };
  }

  function paramArm(S, E, W, rig, z, shrug, hand) {
    var u = sub(E, S), f = sub(W, E);
    return {
      au: Math.atan2(u.y, u.x), ku: len(u) / rig.L1,
      af: Math.atan2(f.y, f.x), kf: len(f) / rig.L2,
      z: z, shrug: shrug,
      hand: hand.map(function (p) { return { x: p.x, y: p.y, z: p.z }; })
    };
  }

  // Param pose -> absolute joints for drawing.
  function toJoints(pose, rig) {
    return {
      arms: pose.arms.map(function (a, i) {
        var S = rig.pivot(i, a.shrug);
        var E = { x: S.x + Math.cos(a.au) * a.ku * rig.L1, y: S.y + Math.sin(a.au) * a.ku * rig.L1 };
        var W = { x: E.x + Math.cos(a.af) * a.kf * rig.L2, y: E.y + Math.sin(a.af) * a.kf * rig.L2 };
        var hand = a.hand.map(function (p) { var q = rot(p, a.af); return { x: W.x + q.x, y: W.y + q.y, z: p.z }; });
        return { S: S, E: E, W: W, z: a.z, hand: hand };
      }),
      head: { roll: pose.head.roll, dx: pose.head.dx }
    };
  }

  function lerpPose(a, b, u) {
    return {
      arms: a.arms.map(function (x, i) {
        var y = b.arms[i];
        return {
          au: lerpAngle(x.au, y.au, u), ku: lerp(x.ku, y.ku, u),
          af: lerpAngle(x.af, y.af, u), kf: lerp(x.kf, y.kf, u),
          z: lerp(x.z, y.z, u), shrug: lerp(x.shrug, y.shrug, u),
          hand: x.hand.map(function (p, j) {
            var q = y.hand[j];
            return { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), z: lerp(p.z, q.z, u) };
          })
        };
      }),
      head: { roll: lerp(a.head.roll, b.head.roll, u), dx: lerp(a.head.dx, b.head.dx, u) }
    };
  }

  function lerpHand(h0, h1, u) {
    return h0.map(function (p, j) { var q = h1[j]; return { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), z: lerp(p.z, q.z, u) }; });
  }

  // Avatar nose position for a head pose.
  function avatarNose(rig, head) {
    return add(add(rig.head.anchor, rot(rig.face.noseFromAnchor, head.roll)), { x: head.dx, y: 0 });
  }

  function headOf(clip, pose, cal) {
    var P = Clip.P;
    var L = Clip.px(clip, pose[P.earL]), R = Clip.px(clip, pose[P.earR]), N = Clip.px(clip, pose[P.nose]);
    var rollS = Math.atan2(L.y - R.y, L.x - R.x);
    var mid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
    return {
      rollS: rollS,
      roll: clamp(rollS, -ROLL_MAX, ROLL_MAX),
      dx: clamp((N.x - mid.x) / cal.eps * 60, -DX_MAX, DX_MAX)
    };
  }

  // Retargets one stored frame (with a pose) -> { pose, detected: [bool, bool], face: [w, w] }.
  function retargetFrame(clip, cal, rig, frame, head) {
    var P = Clip.P;
    var pose = frame[0];
    var N_s = Clip.px(clip, pose[P.nose]);
    var socketGap = rig.sockets[1].x - rig.sockets[0].x;
    var sh = rig.palm / cal.palm;
    var detected = [false, false], faceW = [0, 0];
    var arms = Clip.ARMS.map(function (A, i) {
      var S_s = Clip.px(clip, pose[A.S]), E_s = Clip.px(clip, pose[A.E]), Wp = Clip.px(clip, pose[A.W]);
      var hp = frame[A.hand] ? frame[A.hand].map(function (p) { return Clip.px(clip, p); }) : null;
      var W_s = hp ? hp[0] : Wp;
      var shrug = clamp((S_s.y - cal.shoulderY[i]) * (socketGap / cal.sigma), -SHRUG_MAX, SHRUG_MAX);
      var S = rig.pivot(i, shrug);
      var ue = sub(E_s, S_s), fe = sub(W_s, E_s);
      var ku = Math.min(1, len(ue) / cal.U), kf = Math.min(1, len(fe) / cal.F);
      var E = add(S, mul(unit(ue), ku * rig.L1));
      var W = add(E, mul(unit(fe), kf * rig.L2));

      // Face region: map the hand's point nearest the nose onto the caricature face.
      var C_s = W_s;
      if (hp) {
        var bestD = Infinity;
        hp.forEach(function (p) { var dd = Math.hypot(p.x - N_s.x, p.y - N_s.y); if (dd < bestD) { bestD = dd; C_s = p; } });
      }
      var r = Math.hypot(C_s.x - N_s.x, C_s.y - N_s.y) / cal.eps;
      var w = 1 - smoothstep(1.2, 2.2, r);
      faceW[i] = w;
      if (w > 0) {
        var R = head.roll - head.rollS;
        var C_f = add(avatarNose(rig, head), mul(rot(sub(C_s, N_s), R), rig.face.earWidth / cal.eps));
        // the hand is drawn unrotated (W + (P - P0) * sh), so its offset is not rotated by R either:
        // that keeps the contact point exact when the signer's head is tilted
        var W_f = sub(C_f, mul(sub(C_s, W_s), sh));
        var T = { x: lerp(W.x, W_f.x, w), y: lerp(W.y, W_f.y, w) };
        var side = Math.sign(cross(sub(W_s, S_s), sub(E_s, S_s)));
        var ik = solveIK(S, T, ku * rig.L1, kf * rig.L2, side, rig.L1, rig.L2);
        E = ik.E; W = ik.W;
      }
      var af = Math.atan2(W.y - E.y, W.x - E.x);
      var hand = null;
      if (hp) {
        detected[i] = true;
        hand = hp.map(function (p) {
          var q = rot({ x: (p.x - hp[0].x) * sh, y: (p.y - hp[0].y) * sh }, -af);
          return { x: q.x, y: q.y, z: (p.z - hp[0].z) * sh };
        });
      }
      var arm = paramArm(S, E, W, rig, pose[A.W][2], shrug, hand || rig.restHand[i]);
      if (!hand) arm.hand = null;
      return arm;
    });
    return { pose: { arms: arms, head: { roll: head.roll, dx: head.dx } }, detected: detected, face: faceW };
  }

  // Fill missing hands (decision 7): gaps <= GAP_INTERP frames interpolate between the neighbouring
  // detected shapes; longer gaps hold the nearest detected shape and ease toward the relaxed hand.
  function fillHands(poses, armIndex, rig, fps) {
    var n = poses.length;
    var det = [];
    for (var i = 0; i < n; i++) if (poses[i].arms[armIndex].hand) det.push(i);
    var rest = rig.restHand[armIndex];
    var easeFrames = Math.max(1, REST_EASE_S * fps);
    var k = 0;
    for (i = 0; i < n; i++) {
      var arm = poses[i].arms[armIndex];
      if (arm.hand) continue;
      while (k < det.length && det[k] < i) k++;
      var prev = k > 0 ? det[k - 1] : -1;
      var next = k < det.length ? det[k] : -1;
      if (prev < 0 && next < 0) { arm.hand = lerpHand(rest, rest, 0); continue; }
      if (prev >= 0 && next >= 0 && next - prev - 1 <= GAP_INTERP) {
        arm.hand = lerpHand(poses[prev].arms[armIndex].hand, poses[next].arms[armIndex].hand, (i - prev) / (next - prev));
        continue;
      }
      var near = prev < 0 ? next : next < 0 ? prev : (i - prev <= next - i ? prev : next);
      var u = smoothstep(0, 1, Math.abs(i - near) / easeFrames);
      arm.hand = lerpHand(poses[near].arms[armIndex].hand, rest, u);
    }
  }

  // Zero-lag temporal smoothing (5-tap binomial 1-4-6-4-1, about +-1 frame), applied after the gap
  // fill. The prototype hid detection jitter with a per-tick exponential low-pass in its player
  // (avatar_test_my_name_is.html tick(): k = 1 - exp(-dt / 55)); doing it once here keeps the player
  // cheap and adds no lag. Angles are unwrapped against the frame itself before averaging.
  var KERNEL = [1, 4, 6, 4, 1];
  function smoothPoses(poses) {
    var n = poses.length;
    if (n < 3) return poses;
    function at(i) { return poses[Math.max(0, Math.min(n - 1, i))]; }
    return poses.map(function (p, i) {
      var arms = p.arms.map(function (a, ai) {
        var o = { au: 0, ku: 0, af: 0, kf: 0, z: 0, shrug: 0, hand: a.hand.map(function () { return { x: 0, y: 0, z: 0 }; }) };
        KERNEL.forEach(function (w, kk) {
          var q = at(i + kk - 2).arms[ai];
          w /= 16;
          o.au += w * (a.au + wrap(q.au - a.au));
          o.af += w * (a.af + wrap(q.af - a.af));
          o.ku += w * q.ku; o.kf += w * q.kf; o.z += w * q.z; o.shrug += w * q.shrug;
          q.hand.forEach(function (h, j) { o.hand[j].x += w * h.x; o.hand[j].y += w * h.y; o.hand[j].z += w * h.z; });
        });
        return o;
      });
      return { arms: arms, head: p.head };
    });
  }
  function wrap(d) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  // Whole clip -> { fps, cal, poses: [param pose per frame], faceMax }.
  // opts.smooth === false skips smoothPoses (tests of the gap fill only).
  function prepare(clip, rig, opts) {
    var cal = Clip.calibrate(clip);
    var heads = clip.frames.map(function (f) { return f[0] ? headOf(clip, f[0], cal) : null; });
    // 3-tap smoothing of the head (low-pass), over frames that have a pose.
    var smooth = heads.map(function (h, i) {
      if (!h) return null;
      var acc = { roll: 0, dx: 0 }, cnt = 0;
      for (var j = i - 1; j <= i + 1; j++) if (heads[j]) { acc.roll += heads[j].roll; acc.dx += heads[j].dx; cnt++; }
      return { rollS: h.rollS, roll: acc.roll / cnt, dx: acc.dx / cnt };
    });
    var out = [];
    var faceMax = 0;
    clip.frames.forEach(function (f, i) {
      if (!f[0]) { out.push(null); return; }
      var r = retargetFrame(clip, cal, rig, f, smooth[i]);
      faceMax = Math.max(faceMax, r.face[0], r.face[1]);
      out.push(r.pose);
    });
    // Frames without a pose copy the nearest frame that has one (hand included, so fillHands treats
    // that copied hand as detected: only pose dropouts are affected).
    var firstGood = out.findIndex(function (p) { return p; });
    for (var i = 0; i < out.length; i++) {
      if (!out[i]) out[i] = i < firstGood ? out[firstGood] : out[i - 1];
    }
    out = out.map(function (p) {
      return { arms: p.arms.map(function (a) { return Object.assign({}, a); }), head: p.head };
    });
    fillHands(out, 0, rig, clip.fps);
    fillHands(out, 1, rig, clip.fps);
    return { fps: clip.fps, cal: cal, poses: opts && opts.smooth === false ? out : smoothPoses(out), faceMax: faceMax };
  }

  var api = {
    prepare: prepare,
    retargetFrame: retargetFrame,
    restPose: restPose,
    toJoints: toJoints,
    lerpPose: lerpPose,
    solveIK: solveIK,
    avatarNose: avatarNose,
    smoothstep: smoothstep,
    smoothPoses: smoothPoses,
    GAP_INTERP: GAP_INTERP
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AvatarRetarget = api;
})();
