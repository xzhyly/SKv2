// js/seq-recognizer.js
// Whole-sign recognition, the live part (seq-recognition phase, 2026-11-15): cuts the camera's hand frames into
// signs and gives ONE answer per sign (js/seq-features.js), instead of an answer per frame.
// No DOM; browser (window.SeqRecognizer) and node (module.exports).
//
// A sign starts when a hand comes into view, or moves again after a hold. It ends when (owner choice 2026-11-15)
//   - every hand has been gone for NO_HAND_MS (lowered / out of the picture), or
//   - the hands have been still for STILL_MS (a hold).
// Then the frames from start to end are classified once. The answer is given only when it is clear
// (ratio < RATIO, see js/seq-features.js); otherwise the event is 'unsure' and nothing is added.
// After a hold the recognizer waits for the hands to move (or leave) before the next sign starts. The hand going
// down after a hold is not a sign: a sign that starts from a hold, ends with the hands gone and is shorter than
// DROP_MS is ignored.
//
// create({ model, onEvent }) -> { push(frame), reset(), setModel(model), state() }
//   frame: { t: ms, hands: [{ label: 'Right'|'Left', landmarks: [21 x {x, y, z}] }] }  (hands may be empty)
//   events: { type: 'begin' } · { type: 'sign', label, ratio, top, reason: 'still'|'gone', frames, ms }
//           · { type: 'unsure', ... same fields, label = best guess } · { type: 'ignored', why }
(function () {
  'use strict';
  var SF = (typeof module !== 'undefined' && module.exports) ? require('./seq-features.js') : window.SeqFeatures;

  var NO_HAND_MS = 400;     // no hand this long -> the sign has ended
  var STILL_MS = 600;       // hands still this long -> the sign has ended (hold)
  var STILL_TOL = 0.30;     // "still": no landmark moved more than this (in palm lengths) during STILL_MS
  var RESUME_TOL = 0.45;    // after a hold: a landmark this far from the held pose starts the next sign
  var MIN_FRAMES = 4;
  var MIN_MS = 350;
  var MAX_MS = 6000;        // a sign never runs longer: classify what there is
  var DROP_MS = 900;        // from a hold to hands gone in less than this: the hand going down, not a sign
  var RATIO = 0.90;
  var RATIO_TAIL = 0.80;
  // A slow camera / MediaPipe (the Pi) misses the hand now and then for a frame or two. "Hands gone" must last
  // at least GONE_FRAMES of the measured time between frames, so one or two missed frames do not cut a sign in two.
  var GONE_FRAMES = 3.5;   // measured: tools/seq_eval/stream.mjs --fps 5 --drop 0.25 (report)

  function palm(h) {
    var a = h.landmarks[0], b = h.landmarks[9];
    return Math.hypot((a.x - b.x) * SF.INPUT_W, (a.y - b.y) * SF.INPUT_H) || 1;
  }
  // The largest landmark movement between two frames, in palm lengths; Infinity when the hands differ.
  function moved(f1, f2) {
    if (f1.hands.length !== f2.hands.length) return Infinity;
    var worst = 0;
    for (var i = 0; i < f1.hands.length; i++) {
      var a = f1.hands[i], b = null;
      for (var k = 0; k < f2.hands.length; k++) if (f2.hands[k].label === a.label) { b = f2.hands[k]; break; }
      if (!b) b = f2.hands[i];
      var size = palm(a);
      for (var j = 0; j < 21; j += 4) {   // wrist, and a joint / tip of each finger: 0, 4, 8, 12, 16, 20
        var d = Math.hypot((a.landmarks[j].x - b.landmarks[j].x) * SF.INPUT_W, (a.landmarks[j].y - b.landmarks[j].y) * SF.INPUT_H) / size;
        if (d > worst) worst = d;
      }
    }
    return worst;
  }

  function create(opts) {
    opts = opts || {};
    var model = opts.model || null;
    var emit = opts.onEvent || function () {};
    var ratioMax = typeof opts.ratio === 'number' ? opts.ratio : RATIO;
    var st = 'idle';              // 'idle' | 'signing' | 'held'
    var seg = [];                 // frames with hands of the running sign
    var fromHold = false;
    var lastHandAt = 0;
    var heldPose = null;
    var lastLabel = null;         // the last sign given since the hands were last down
    var lastT = null, dtAvg = 0;  // time between frames (running average)
    function goneMs() { return Math.max(NO_HAND_MS, GONE_FRAMES * dtAvg); }

    function begin(frame, afterHold, first) {
      st = 'signing';
      fromHold = afterHold;
      seg = first ? [first, frame] : [frame];
      emit({ type: 'begin' });
    }
    function end(reason) {
      var frames = seg;
      seg = [];
      var ms = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
      heldPose = reason === 'still' && frames.length ? frames[frames.length - 1] : null;
      st = reason === 'still' ? 'held' : 'idle';
      if (opts.onSegment) { if (frames.length >= MIN_FRAMES && ms >= MIN_MS) opts.onSegment(frames, reason, fromHold); return; }
      if (frames.length < MIN_FRAMES || ms < MIN_MS) { emit({ type: 'ignored', why: 'too short', frames: frames.length, ms: ms }); return; }
      if (fromHold && reason === 'gone' && ms < DROP_MS) { emit({ type: 'ignored', why: 'hand lowered after a hold', frames: frames.length, ms: ms }); return; }
      if (!model) { emit({ type: 'ignored', why: 'no model', frames: frames.length, ms: ms }); return; }
      var r = SF.classify(model, SF.vector(frames));
      if (!r) { emit({ type: 'ignored', why: 'no result', frames: frames.length, ms: ms }); return; }
      // A piece that starts from a hold and ends with the hands going down is usually the end of the sign already
      // given (the hand on its way down), so it needs a clearer answer (RATIO_TAIL) to count as a new sign.
      var sure = r.ratio < (fromHold && reason === 'gone' ? Math.min(ratioMax, RATIO_TAIL) : ratioMax);
      // The same sign again straight out of a hold (no hands down in between) is the same sign continuing.
      if (sure && fromHold && r.label === lastLabel) { emit({ type: 'ignored', why: 'same sign continuing', frames: frames.length, ms: ms }); return; }
      if (sure) lastLabel = r.label;
      emit({ type: sure ? 'sign' : 'unsure', label: r.label, ratio: r.ratio, second: r.second, top: r.top,
        reason: reason, fromHold: fromHold, frames: frames.length, ms: ms });
    }
    function isStill() {
      var last = seg[seg.length - 1];
      if (last.t - seg[0].t < STILL_MS) return false;
      var n = 0;
      for (var i = seg.length - 2; i >= 0; i--) {
        if (moved(seg[i], last) > STILL_TOL) return false;
        n++;
        if (last.t - seg[i].t >= STILL_MS) return n >= 2;
      }
      return false;
    }

    function push(frame) {
      var has = frame && frame.hands && frame.hands.length > 0;
      var t = frame.t;
      if (lastT !== null && t > lastT && t - lastT < 1000) dtAvg = dtAvg ? dtAvg * 0.9 + (t - lastT) * 0.1 : t - lastT;
      lastT = t;
      if (has) lastHandAt = t;
      if (st === 'idle') {
        if (has) begin(frame, false);
      } else if (st === 'signing') {
        if (has) {
          seg.push(frame);
          if (isStill()) end('still');
          else if (t - seg[0].t >= MAX_MS) end('still');
        } else if (t - lastHandAt >= goneMs()) { end('gone'); lastLabel = null; }
      } else {   // held
        if (has) {
          if (moved(heldPose, frame) > RESUME_TOL) begin(frame, true, heldPose);
        } else if (t - lastHandAt >= goneMs()) { st = 'idle'; heldPose = null; lastLabel = null; }
      }
    }
    function reset() { st = 'idle'; seg = []; heldPose = null; fromHold = false; lastLabel = null; }   // keeps the frame-time average

    return { push: push, reset: reset, setModel: function (m) { model = m; }, state: function () { return st; },
      frames: function () { return seg.length; }, goneMs: goneMs };
  }

  // The pieces the recognizer cuts one recorded sample into (frames: a v3 sample's frames, with t in ms).
  function segmentsOf(frames) {
    var out = [];
    var r = create({ onSegment: function (fr) { out.push(fr); } });
    var last = 0;
    (frames || []).forEach(function (f) {
      last = f.t;
      r.push({ t: f.t, hands: (f.hands || []).filter(function (h) { return h && h.landmarks && h.landmarks.length >= 21; }) });
    });
    r.push({ t: last + NO_HAND_MS + 1, hands: [] });
    return out;
  }

  // MediaPipe Hands results (multiHandLandmarks + multiHandedness) -> a frame for push().
  function frameFromResults(results, t) {
    var lms = (results && results.multiHandLandmarks) || [];
    var hd = (results && results.multiHandedness) || [];
    return { t: t, hands: lms.slice(0, 2).map(function (lm, i) { return { label: (hd[i] && hd[i].label) || 'Right', landmarks: lm }; }) };
  }

  var api = { create: create, segmentsOf: segmentsOf, frameFromResults: frameFromResults, moved: moved,
    NO_HAND_MS: NO_HAND_MS, STILL_MS: STILL_MS, RATIO: RATIO, DROP_MS: DROP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SeqRecognizer = api;
})();
