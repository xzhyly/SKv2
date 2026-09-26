// Sining Kamay - video-based gesture capture: core constants and the pure, DOM-free
// hand-presence segmenter shared by the live recording UI and offline video segmentation.
//
// Plain script, no DOM access: attaches window.GestureCaptureCore in the browser and sets
// module.exports under node, so both talk/gesture-training-style <script> pages and node
// tests (via createRequire) can use it. See docs/system for the phase this belongs to.
(function () {
  'use strict';

  var CAPTURE = Object.freeze({
    REST_MS: 1000,
    MIN_REP_MS: 300,
    MAX_REP_MS: 20000,
    NO_HAND_HINT_MS: 10000,
    REQUIRED_REPS: 3,
    PROCESS_FPS: 15,
    STOP_TAIL_MS: 500,
    MAX_FRAMES_PER_REP: 301,
  });

  // createSegmenter(constants) -> a fresh state machine instance.
  //
  // Phases: 'rest' -> 'wait-hand' -> 'rep' -> ('wait-hand' | 'done' | 'failed').
  // 'done' and 'failed' can only be reached as documented below; 'failed' is terminal.
  function createSegmenter(constants) {
    var c = constants || CAPTURE;

    var phase = 'rest';
    var repIndex = 1;
    var repsDone = 0;
    var phaseStartMs = null;
    var lastHandMs = null;
    var failReason = null;
    var reps = [];

    // internal only
    var noHandRunStart = null; // 'rest' phase: t of the first no-hand frame of the current run
    var repStart = null; // 'rep' phase: t the current rep started (mirrors phaseStartMs while in 'rep')

    // Closes the currently-open rep at time t, exactly as a no-hand frame reaching REST_MS
    // (or finish()) would. Sets phase/event/repIndex/phaseStartMs as a side effect.
    function closeRepAt(t) {
      var span = lastHandMs - repStart;
      if (span < c.MIN_REP_MS) {
        phase = 'wait-hand';
        phaseStartMs = t;
        return 'blip-ignored';
      }
      reps.push({ index: repIndex, startMs: repStart, endMs: lastHandMs });
      repsDone++;
      if (repsDone >= c.REQUIRED_REPS) {
        phase = 'done';
        phaseStartMs = t;
        return 'done';
      }
      phase = 'wait-hand';
      phaseStartMs = t;
      repIndex++;
      return 'rep-ended';
    }

    function push(tMs, handPresent) {
      if (phaseStartMs === null) {
        phaseStartMs = tMs;
      }

      var event = null;

      if (phase === 'failed') {
        return { phase: phase, repIndex: repIndex, event: null };
      }

      if (phase === 'rest') {
        if (handPresent) {
          noHandRunStart = null;
        } else {
          if (noHandRunStart === null) {
            noHandRunStart = tMs;
          }
          if (tMs - noHandRunStart >= c.REST_MS) {
            phase = 'wait-hand';
            phaseStartMs = tMs;
            event = 'rest-reached';
          }
        }
      } else if (phase === 'wait-hand') {
        if (handPresent) {
          phase = 'rep';
          phaseStartMs = tMs;
          repStart = tMs;
          lastHandMs = tMs;
          event = 'rep-started';
        }
      } else if (phase === 'rep') {
        if (handPresent) {
          lastHandMs = tMs;
          if (lastHandMs - repStart > c.MAX_REP_MS) {
            phase = 'failed';
            failReason = 'rep-too-long';
            event = 'rep-too-long';
          }
        } else if (tMs - lastHandMs >= c.REST_MS) {
          event = closeRepAt(tMs);
        }
      } else if (phase === 'done') {
        if (handPresent) {
          repIndex = repIndex + 1;
          phase = 'rep';
          phaseStartMs = tMs;
          repStart = tMs;
          lastHandMs = tMs;
          event = 'rep-started';
        }
      }

      return { phase: phase, repIndex: repIndex, event: event };
    }

    function finish(endMs) {
      var event = null;
      if (phase === 'rep' && endMs - lastHandMs >= c.REST_MS) {
        event = closeRepAt(endMs);
      }
      return { phase: phase, repIndex: repIndex, event: event };
    }

    function state() {
      return {
        phase: phase,
        repIndex: repIndex,
        repsDone: repsDone,
        phaseStartMs: phaseStartMs,
        lastHandMs: lastHandMs,
        failReason: failReason,
      };
    }

    function getReps() {
      return reps.slice();
    }

    return {
      push: push,
      finish: finish,
      state: state,
      reps: getReps,
    };
  }

  // segmentFrames(frames, options) -> offline pass over a full recording's frames.
  // frames: [{ t, handPresent }], non-decreasing t. options: { endMs, constants }.
  function segmentFrames(frames, options) {
    var opts = options || {};
    var c = opts.constants || CAPTURE;
    var seg = createSegmenter(c);

    for (var i = 0; i < frames.length; i++) {
      seg.push(frames[i].t, frames[i].handPresent);
    }

    var endMs;
    if (opts.endMs !== undefined && opts.endMs !== null) {
      endMs = opts.endMs;
    } else if (frames.length > 0) {
      endMs = frames[frames.length - 1].t;
    } else {
      endMs = 0;
    }
    seg.finish(endMs);

    var st = seg.state();
    var closedReps = seg.reps();

    function annotate(rep) {
      var startFrame = -1;
      var endFrame = -1;
      for (var i2 = 0; i2 < frames.length; i2++) {
        if (startFrame === -1 && frames[i2].t === rep.startMs && frames[i2].handPresent) {
          startFrame = i2;
        }
      }
      for (var j = frames.length - 1; j >= 0; j--) {
        if (endFrame === -1 && frames[j].t === rep.endMs && frames[j].handPresent) {
          endFrame = j;
        }
      }
      return {
        index: rep.index,
        startMs: rep.startMs,
        endMs: rep.endMs,
        startFrame: startFrame,
        endFrame: endFrame,
      };
    }

    var annotatedReps = closedReps.map(annotate);
    var repsFound = closedReps.length;

    if (st.phase === 'failed') {
      return { ok: false, reason: 'rep-too-long', repsFound: repsFound, reps: annotatedReps };
    }

    if (st.phase === 'rest') {
      return { ok: false, reason: 'no-rest', repsFound: repsFound, reps: annotatedReps };
    }

    var openExtraRepTooMany =
      st.phase === 'rep' && st.repIndex > c.REQUIRED_REPS && st.lastHandMs - st.phaseStartMs >= c.MIN_REP_MS;

    if (repsFound > c.REQUIRED_REPS || openExtraRepTooMany) {
      return { ok: false, reason: 'too-many-reps', repsFound: repsFound, reps: annotatedReps };
    }

    if (repsFound < c.REQUIRED_REPS) {
      return { ok: false, reason: 'too-few-reps', repsFound: repsFound, reps: annotatedReps };
    }

    return { ok: true, reps: annotatedReps };
  }

  var api = {
    CAPTURE: CAPTURE,
    createSegmenter: createSegmenter,
    segmentFrames: segmentFrames,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.GestureCaptureCore = api;
  }
})();
