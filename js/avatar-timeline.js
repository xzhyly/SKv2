// js/avatar-timeline.js
// A sentence of prepared clips -> one continuous timeline (decision 5):
//   rest --IN_MS--> clip 1 --BLEND_MS--> clip 2 ... clip n --OUT_MS--> rest  (minimums, see SPEED_MAX)
// A transition is new time inserted between the LAST frame of one clip and the FIRST frame of the
// next, blended in param-pose space (angles along the shortest arc, smoothstep easing), so the
// avatar never drops to the rest pose between signs and bones never shrink mid-blend.
// Also splitRuns(): which words play on the avatar and which fall back to video.
// Pure: no DOM.
(function () {
  'use strict';

  var Retarget = (typeof module !== 'undefined' && module.exports) ? require('./avatar-retarget.js') : window.AvatarRetarget;

  var IN_MS = 350;
  var BLEND_MS = 250;
  var OUT_MS = 400;
  // A transition moves no drawn joint faster than SPEED_MAX px per 40 ms at its peak: the base
  // duration above is a minimum, lengthened for poses far apart. The speed is measured on the
  // blended path itself (PATH_STEPS samples of lerpPose, which runs in angle space, so an arc, not
  // the straight line between the end poses) times smoothstep's peak rate (1.5x the mean).
  // MAX_TRANSITION_MS caps the lengthening. Measured reasons: a fixed 250 ms blend between two
  // far-apart signs moved a joint 82.8 px in 40 ms; a straight-line estimate still gave 61 px.
  // (Continuity threshold 60 px, step 1 report Q14.)
  var SPEED_MAX = 50;
  var MAX_TRANSITION_MS = 700;
  var PATH_STEPS = 16;

  function points(pose, rig) {
    var out = [];
    Retarget.toJoints(pose, rig).arms.forEach(function (a) { out.push(a.S, a.E, a.W); out.push.apply(out, a.hand); });
    return out;
  }

  // Largest joint displacement per unit of the blend parameter u (0..1) along the blended path.
  function pathSpeed(a, b, rig) {
    var prev = points(a, rig), m = 0;
    for (var k = 1; k <= PATH_STEPS; k++) {
      var cur = points(Retarget.lerpPose(a, b, k / PATH_STEPS), rig);
      for (var j = 0; j < cur.length; j++) m = Math.max(m, Math.hypot(cur[j].x - prev[j].x, cur[j].y - prev[j].y));
      prev = cur;
    }
    return m * PATH_STEPS;
  }

  function transitionMs(a, b, base, rig) {
    return Math.min(MAX_TRANSITION_MS, Math.max(base, Math.ceil(1.5 * pathSpeed(a, b, rig) * 40 / SPEED_MAX)));
  }

  function ease(u) { return u * u * (3 - 2 * u); }

  function clipDuration(prep) { return Math.max(prep.poses.length - 1, 1) * 1000 / prep.fps; }

  function sampleClip(prep, ms) {
    var f = ms * prep.fps / 1000;
    var n = prep.poses.length;
    if (f <= 0) return prep.poses[0];
    if (f >= n - 1) return prep.poses[n - 1];
    var i = Math.floor(f);
    return Retarget.lerpPose(prep.poses[i], prep.poses[i + 1], f - i);
  }

  // preps: [prepared clip] (js/avatar-retarget.js prepare()). Returns
  // { duration, segments, poseAt(ms) -> {pose, word} } where word is the index of the sign whose
  // incoming transition or clip is playing (the caption switches as the hand starts moving).
  function build(preps, rig) {
    var rest = Retarget.restPose(rig);
    var segs = [];
    var t = 0;
    preps.forEach(function (prep, i) {
      var from = i === 0 ? rest : preps[i - 1].poses[preps[i - 1].poses.length - 1];
      var dur = transitionMs(from, prep.poses[0], i === 0 ? IN_MS : BLEND_MS, rig);
      segs.push({ kind: i === 0 ? 'in' : 'blend', word: i, t0: t, t1: t + dur, a: from, b: prep.poses[0] });
      t += dur;
      var cd = clipDuration(prep);
      segs.push({ kind: 'clip', word: i, t0: t, t1: t + cd, prep: prep });
      t += cd;
    });
    if (preps.length) {
      var lastPrep = preps[preps.length - 1];
      var lastPose = lastPrep.poses[lastPrep.poses.length - 1];
      var outMs = transitionMs(lastPose, rest, OUT_MS, rig);
      segs.push({ kind: 'out', word: preps.length - 1, t0: t, t1: t + outMs, a: lastPose, b: rest });
      t += outMs;
    }
    var duration = t;

    function poseAt(ms) {
      if (!segs.length || ms <= 0) return { pose: rest, word: segs.length ? 0 : -1 };
      if (ms >= duration) return { pose: rest, word: preps.length - 1 };
      var s = segs[0];
      for (var k = 0; k < segs.length; k++) { if (ms < segs[k].t1) { s = segs[k]; break; } }
      if (s.kind === 'clip') return { pose: sampleClip(s.prep, ms - s.t0), word: s.word };
      return { pose: Retarget.lerpPose(s.a, s.b, ease((ms - s.t0) / (s.t1 - s.t0))), word: s.word };
    }

    return { duration: duration, segments: segs, rest: rest, poseAt: poseAt };
  }

  // items: [{ item, key|null }] in sentence order. Consecutive items that have a key (a sign with an
  // avatar clip) form one avatar run; every other item is its own video item.
  // -> [{ type: 'avatar', items: [...] } | { type: 'video', item }]
  function splitRuns(items) {
    var out = [];
    items.forEach(function (it) {
      if (it.key) {
        var last = out[out.length - 1];
        if (last && last.type === 'avatar') last.items.push(it);
        else out.push({ type: 'avatar', items: [it] });
      } else {
        out.push({ type: 'video', item: it.item });
      }
    });
    return out;
  }

  var api = { build: build, splitRuns: splitRuns, transitionMs: transitionMs, IN_MS: IN_MS, BLEND_MS: BLEND_MS, OUT_MS: OUT_MS, SPEED_MAX: SPEED_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AvatarTimeline = api;
})();
