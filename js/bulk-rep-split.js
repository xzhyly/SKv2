// js/bulk-rep-split.js
// Dynamic repetition split for bulk-import.html (docs/reports/2026-10-16-bulk-reps-fix.md).
// Every group video holds exactly 3 repetitions, but the signers rest only about 1 s between them,
// often with the hand lowered and still in the picture, and stop the video right after the 3rd.
// The live capture's segmenter (js/capture-core.js, REST_MS 1000 of no detected hand) therefore
// merged reps on most videos. This splitter does not wait for a fixed rest: it scores every frame
// for "rest" (no hand / hand lowered below this video's own signing zone / nearly still while low),
// finds the rest runs, and picks the 2 runs that best cut the video into 3 reps.
// Live capture is NOT affected: it keeps js/capture-core.js and REST_MS 1000.
//
// Input: the per-frame raw MediaPipe Hands results of VideoLandmarks.extractVideoLandmarks
// ({t, hands:[{landmarks:[{x,y,z} x21]}]}), image-space (0..1 of the letterboxed input canvas,
// y grows downwards), BEFORE any normalisation.
// Pure: no DOM, no fetch, no clock. Attaches window.BulkRepSplit, and module.exports under node.
(function () {
  'use strict';

  // Every threshold of the split, in one place (tuning notes: docs/reports/2026-10-16-bulk-reps-fix.md
  // section 2). Change VERSION with any of them: the page then redoes each cached video's split from
  // its cached frames (no video is read again), and an older split is never reused silently.
  var SPLIT = Object.freeze({
    VERSION: 1,
    REPS: 3,                  // every group video holds exactly 3 repetitions
    // per-frame rest score
    SIGN_LEVEL_PCT: 0.35,     // the signing level = this percentile of the highest wrist's y over hand frames
    LOW_DROP_HANDS: 1.5,      // "lowered": wrist at least this many hand lengths below the signing level ...
    BOTTOM_Y: 0.9,            // ... or (when that line falls lower) at least this low in the picture
    HALF_DROP_HANDS: 0.75,    // "low enough to rest": half of that drop; counts only when nearly still
    STILL_SPEED: 0.25,        // "nearly still": wrist speed below this many picture heights per second
    MIN_HAND_SIZE: 0.04,      // floor of the hand length (wrist -> middle knuckle), picture heights
    MIN_HAND_FRAMES: 8,       // fewer hand frames: no signing zone is learned (only "no hand" rests)
    DEPTH_NO_HAND: 1.0,       // rest score of a frame with no hand detected
    DEPTH_LOWERED: 0.8,       // ... with every visible hand lowered
    DEPTH_STILL_LOW: 0.6,     // ... nearly still and low enough
    // rest runs
    GAP_MS: 140,              // a non-rest blip up to this long inside a rest run is bridged (2 frames at 15 fps)
    MIN_REST_MS: 200,         // the shortest rest run that can split two reps
    FULL_REST_MS: 600,        // a run this long (or longer) counts fully; a shorter one in proportion
    // choosing the 2 cuts
    BALANCE_WEIGHT: 1.0,      // pair score = strength 1 + strength 2 + BALANCE_WEIGHT x (shortest rep / longest rep)
    MIN_REP_MS: 300,          // a rep shorter than this (first to last signing frame) is not a rep
    // confidence: the row is a problem row when any of these holds
    WEAK_CUT: 0.35,           // a chosen cut weaker than this is "no clear rest"
    MIN_BALANCE: 0.5,         // shortest rep / longest rep below this is "reps of very different length"
    RIVAL_RATIO: 0.9,         // an unused rest at least this strong (x the weaker cut) makes the split doubtful
    MAX_RUNS_KEPT: 12         // rest runs kept in the result (the strongest), for the tuning notes
  });

  // Per-frame class, also the characters of the profile string (one per frame).
  var SIGN = 0, STILL_LOW = 1, LOWERED = 2, NO_HAND = 3;
  var KIND = ['signing', 'hand nearly still and low', 'hand lowered', 'no hand'];

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function percentile(values, p) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var at = p * (s.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
    return s[lo] + (s[hi] - s[lo]) * (at - lo);
  }
  function median3(a, b, c) { return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); }
  function round1(ms) { return (Math.round(ms / 100) / 10).toFixed(1); }

  // frames -> per frame: n (hands), hy (y of the highest wrist), cx/cy (mean wrist, x scaled by the
  // picture's aspect so distances are in picture heights), size (mean hand length). null when unknown.
  function frameTrack(frames, aspect) {
    var ax = num(aspect) && aspect > 0 ? aspect : 4 / 3;
    return (frames || []).map(function (f) {
      var hands = f && Array.isArray(f.hands) ? f.hands : [];
      var out = { t: f && num(f.t) ? f.t : 0, n: hands.length, hy: null, cx: null, cy: null, size: null };
      var ys = [], xs = [], sizes = [];
      hands.forEach(function (h) {
        var lm = h && Array.isArray(h.landmarks) ? h.landmarks : null;
        var w = lm && lm[0];
        if (!w || !num(w.x) || !num(w.y)) return;
        ys.push(w.y); xs.push(w.x * ax);
        var m = lm[9];
        if (m && num(m.x) && num(m.y)) sizes.push(Math.sqrt(Math.pow((m.x - w.x) * ax, 2) + Math.pow(m.y - w.y, 2)));
      });
      if (ys.length) {
        out.hy = Math.min.apply(null, ys);
        out.cy = ys.reduce(function (s, v) { return s + v; }, 0) / ys.length;
        out.cx = xs.reduce(function (s, v) { return s + v; }, 0) / xs.length;
      }
      if (sizes.length) out.size = sizes.reduce(function (s, v) { return s + v; }, 0) / sizes.length;
      return out;
    });
  }

  // track -> {cls:[0..3 per frame], zone:{signY, handSize, lowLine, halfLine} | null}.
  // The zone is learned from this video: the signing level is a low percentile of the highest
  // wrist's y (signing frames are most of the hand frames; y grows downwards).
  function classify(track, c) {
    c = c || SPLIT;
    var ys = [], sizes = [];
    track.forEach(function (f) {
      if (f.n > 0 && f.hy !== null) ys.push(f.hy);
      if (f.n > 0 && f.size !== null) sizes.push(f.size);
    });
    var zone = null;
    if (ys.length >= c.MIN_HAND_FRAMES) {
      var signY = percentile(ys, c.SIGN_LEVEL_PCT);
      var hs = Math.max(c.MIN_HAND_SIZE, sizes.length ? percentile(sizes, 0.5) : 0);
      var low = signY + c.LOW_DROP_HANDS * hs;
      if (low > c.BOTTOM_Y) low = Math.max(c.BOTTOM_Y, signY + c.HALF_DROP_HANDS * hs);
      var half = Math.min(low, signY + c.HALF_DROP_HANDS * hs);
      zone = { signY: signY, handSize: hs, lowLine: low, halfLine: half };
    }
    // wrist speed (picture heights per second) between two frames with the same hands visible
    var speed = track.map(function (f, k) {
      var p = track[k - 1];
      if (!p || f.n === 0 || f.n !== p.n || f.cx === null || p.cx === null || f.t <= p.t) return Infinity;
      return Math.sqrt(Math.pow(f.cx - p.cx, 2) + Math.pow(f.cy - p.cy, 2)) / ((f.t - p.t) / 1000);
    });
    var cls = track.map(function (f, k) {
      if (f.n === 0) return NO_HAND;
      if (!zone || f.hy === null) return SIGN;
      if (f.hy >= zone.lowLine) return LOWERED;
      var v = median3(speed[k], k > 0 ? speed[k - 1] : speed[k], k + 1 < speed.length ? speed[k + 1] : speed[k]);
      if (f.hy >= zone.halfLine && v < c.STILL_SPEED) return STILL_LOW;
      return SIGN;
    });
    return { cls: cls, zone: zone };
  }

  function depthOf(cls, c) {
    return cls === NO_HAND ? c.DEPTH_NO_HAND : cls === LOWERED ? c.DEPTH_LOWERED : cls === STILL_LOW ? c.DEPTH_STILL_LOW : 0;
  }

  // cls + frame times -> rest runs [{startFrame, endFrame, startMs, endMs, ms, depth, strength,
  // kind, edge: 'start'|'end'|'all'|null}], short non-rest blips bridged (their depth counts as 0).
  function restRuns(cls, times, fps, c) {
    c = c || SPLIT;
    var frameMs = 1000 / (num(fps) && fps > 0 ? fps : 15);
    var gap = Math.max(0, Math.floor(c.GAP_MS / frameMs + 1e-9));
    var raw = [], k, last = cls.length - 1;
    for (k = 0; k <= last; k++) {
      if (cls[k] === SIGN) continue;
      var top = raw[raw.length - 1];
      if (top && k - top.endFrame - 1 <= gap) top.endFrame = k;
      else raw.push({ startFrame: k, endFrame: k });
    }
    return raw.map(function (r) {
      var sum = 0, counts = [0, 0, 0, 0];
      for (var i = r.startFrame; i <= r.endFrame; i++) { sum += depthOf(cls[i], c); counts[cls[i]]++; }
      var frames = r.endFrame - r.startFrame + 1, ms = frames * frameMs, depth = sum / frames;
      var kind = NO_HAND;
      [LOWERED, STILL_LOW].forEach(function (x) { if (counts[x] > counts[kind]) kind = x; });
      var edge = r.startFrame === 0 && r.endFrame === last ? 'all' : r.startFrame === 0 ? 'start' : r.endFrame === last ? 'end' : null;
      return {
        startFrame: r.startFrame, endFrame: r.endFrame, startMs: times[r.startFrame], endMs: times[r.endFrame],
        ms: Math.round(ms), depth: Math.round(depth * 1000) / 1000,
        strength: Math.round(depth * Math.min(1, ms / c.FULL_REST_MS) * 1000) / 1000,
        kind: KIND[kind], edge: edge
      };
    });
  }

  // For O(1) trimming: next[k] = first signing frame at or after k, prev[k] = last at or before k (-1: none).
  function signIndex(cls) {
    var n = cls.length, next = new Array(n + 1), prev = new Array(n), k, at = -1;
    next[n] = -1;
    for (k = n - 1; k >= 0; k--) next[k] = cls[k] === SIGN ? k : next[k + 1];
    for (k = 0; k < n; k++) { if (cls[k] === SIGN) at = k; prev[k] = at; }
    return { next: next, prev: prev };
  }
  // The rep inside frames a..b: first to last signing frame (rest frames at its ends trimmed off).
  function trimmed(ix, a, b, times) {
    if (a > b || a < 0) return null;
    var s = ix.next[a], e = ix.prev[b];
    if (s < 0 || e < 0 || s > b || e < a || s > e) return null;
    return { startFrame: s, endFrame: e, startMs: times[s], endMs: times[e] };
  }
  function repMs(rep, frameMs) { return rep.endMs - rep.startMs + frameMs; }

  function cutText(run) { return round1(run.startMs) + ' s (' + round1(run.ms) + ' s, ' + run.kind + ')'; }

  // frames -> the split. opts: {fps, aspect (input width / height), constants}.
  // -> {version, method:'dynamic', ok, reasons:[text], reps:[{index, startFrame, endFrame, startMs,
  //     endMs}], cuts:[run], rests:[run] (the strongest interior runs), balance, profile (one
  //     character 0..3 per frame), zone}
  // ok: exactly 3 reps, both cuts clear, reps of plausible similar length, no rival rest.
  function splitReps(frames, opts) {
    opts = opts || {};
    var c = opts.constants || SPLIT;
    var list = Array.isArray(frames) ? frames : [];
    var fps = num(opts.fps) && opts.fps > 0 ? opts.fps : 15, frameMs = 1000 / fps;
    var times = list.map(function (f) { return f && num(f.t) ? f.t : 0; });
    var cl = classify(frameTrack(list, opts.aspect), c);
    var cls = cl.cls;
    var runs = restRuns(cls, times, fps, c);
    var ix = signIndex(cls);
    var out = {
      version: c.VERSION, method: 'dynamic', ok: false, reasons: [], reps: [], cuts: [], rests: [],
      balance: null, profile: cls.join(''), zone: cl.zone
    };
    if (!list.length || ix.next[0] < 0) { out.reasons.push('no signing hand found in the video'); return out; }
    // the reps live between the leading and the trailing rest (the first rep may start at frame 0,
    // the last one runs to the end of the video when there is no rest after it)
    var s0 = 0, e3 = list.length - 1;
    runs.forEach(function (r) {
      if (r.edge === 'start') s0 = r.endFrame + 1;
      if (r.edge === 'end') e3 = r.startFrame - 1;
    });
    var cand = runs.filter(function (r) { return !r.edge && r.ms >= c.MIN_REST_MS; });
    // a rest with no real rep before it (a moment of noise at the start) belongs to the leading
    // rest; the same at the end
    function realRep(a, b) { var rep = trimmed(ix, a, b, times); return !!rep && repMs(rep, frameMs) >= c.MIN_REP_MS; }
    while (cand.length && !realRep(s0, cand[0].startFrame - 1)) s0 = cand.shift().endFrame + 1;
    while (cand.length && !realRep(cand[cand.length - 1].endFrame + 1, e3)) e3 = cand.pop().startFrame - 1;
    out.rests = cand.slice().sort(function (a, b) { return b.strength - a.strength || a.startMs - b.startMs; })
      .slice(0, c.MAX_RUNS_KEPT).sort(function (a, b) { return a.startMs - b.startMs; });

    function repsFor(cuts) {
      var bounds = [s0].concat(cuts.reduce(function (acc, r) { return acc.concat([r.startFrame - 1, r.endFrame + 1]); }, [])).concat([e3]);
      var reps = [];
      for (var i = 0; i < bounds.length; i += 2) {
        var rep = trimmed(ix, bounds[i], bounds[i + 1], times);
        if (!rep || repMs(rep, frameMs) < c.MIN_REP_MS) return null;
        reps.push(rep);
      }
      return reps;
    }
    function balanceOf(reps) {
      var lens = reps.map(function (r) { return repMs(r, frameMs); });
      return Math.min.apply(null, lens) / Math.max.apply(null, lens);
    }
    // the best set of `want` cuts among the candidates (want = 2, else fewer when no pair works)
    var best = null;
    function consider(cuts) {
      var reps = repsFor(cuts);
      if (!reps) return;
      var bal = balanceOf(reps);
      var score = cuts.reduce(function (s, r) { return s + r.strength; }, 0) + c.BALANCE_WEIGHT * bal;
      if (!best || score > best.score + 1e-9) best = { cuts: cuts, reps: reps, balance: bal, score: score };
    }
    var i, j;
    for (i = 0; i < cand.length; i++) for (j = i + 1; j < cand.length; j++) consider([cand[i], cand[j]]);
    if (!best) for (i = 0; i < cand.length; i++) consider([cand[i]]);
    if (!best) consider([]);
    if (!best) { out.reasons.push('no repetition of at least ' + round1(c.MIN_REP_MS) + ' s found'); return out; }

    out.reps = best.reps.map(function (r, k) {
      return { index: k + 1, startFrame: r.startFrame, endFrame: r.endFrame, startMs: r.startMs, endMs: r.endMs };
    });
    out.cuts = best.cuts;
    out.balance = Math.round(best.balance * 1000) / 1000;
    var lens = out.reps.map(function (r) { return round1(repMs(r, frameMs)) + ' s'; }).join(', ');
    if (out.reps.length < c.REPS) {
      out.reasons.push('found ' + out.reps.length + ' repetition' + (out.reps.length === 1 ? '' : 's') + ', need ' + c.REPS +
        ' (' + (cand.length ? 'only ' + cand.length + ' usable rest' + (cand.length === 1 ? '' : 's') : 'no rest between the signs') + ')');
    } else {
      best.cuts.forEach(function (r, k) {
        if (r.strength < c.WEAK_CUT) out.reasons.push('no clear rest between reps ' + (k + 1) + ' and ' + (k + 2) + ': ' + cutText(r));
      });
      if (best.balance < c.MIN_BALANCE) out.reasons.push('reps of very different length (' + lens + ')');
      var weaker = Math.min.apply(null, best.cuts.map(function (r) { return r.strength; }));
      cand.forEach(function (r) {
        if (best.cuts.indexOf(r) >= 0) return;
        if (r.strength >= c.WEAK_CUT && r.strength >= c.RIVAL_RATIO * weaker) {
          out.reasons.push('another rest as clear as the chosen ones at ' + cutText(r) + ': more than 3 reps?');
        }
      });
    }
    out.ok = out.reps.length === c.REPS && !out.reasons.length;
    return out;
  }

  // "Split into 3 equal parts" (the last resort for a problem row), from the profile alone so the
  // Review step and the Import compute the same reps: the time from the first to the last signing
  // frame is cut into `parts` equal parts, each trimmed to its own first..last signing frame (or,
  // without one, its first..last hand frame). A part with no hand at all gives no rep.
  // timeOf(k) -> ms of frame k (the extractor's grid: Math.round(k * 1000 / fps)).
  function equalSplit(profile, timeOf, parts) {
    parts = parts || SPLIT.REPS;
    var p = String(profile || ''), n = p.length, k;
    var first = p.indexOf(String(SIGN)), lastS = p.lastIndexOf(String(SIGN));
    if (first < 0) return [];
    var t0 = timeOf(first), t1 = timeOf(lastS), out = [];
    var bound = function (q) { return t0 + (t1 - t0) * q / parts; };
    for (var q = 0; q < parts; q++) {
      var lo = bound(q), hi = bound(q + 1), sFirst = -1, sLast = -1, hFirst = -1, hLast = -1;
      for (k = first; k <= lastS && k < n; k++) {
        var t = timeOf(k);
        if (t < lo || (q < parts - 1 ? t >= hi : t > hi)) continue;
        if (p.charAt(k) === String(SIGN)) { if (sFirst < 0) sFirst = k; sLast = k; }
        if (p.charAt(k) !== String(NO_HAND)) { if (hFirst < 0) hFirst = k; hLast = k; }
      }
      var s = sFirst >= 0 ? sFirst : hFirst, e = sFirst >= 0 ? sLast : hLast;
      if (s < 0) continue;
      out.push({ index: q + 1, startFrame: s, endFrame: e, startMs: timeOf(s), endMs: timeOf(e) });
    }
    return out;
  }

  // Frames of a rep with at least one hand, from the profile (= hand frames of summarizeReps).
  function handFrames(profile, rep) {
    var p = String(profile || ''), count = 0;
    for (var k = rep.startFrame; k <= rep.endFrame && k < p.length; k++) if (p.charAt(k) !== String(NO_HAND)) count++;
    return count;
  }

  var api = {
    SPLIT: SPLIT,
    CLASS: Object.freeze({ SIGN: SIGN, STILL_LOW: STILL_LOW, LOWERED: LOWERED, NO_HAND: NO_HAND }),
    percentile: percentile,
    frameTrack: frameTrack,
    classify: classify,
    restRuns: restRuns,
    splitReps: splitReps,
    equalSplit: equalSplit,
    handFrames: handFrames
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BulkRepSplit = api;
})();
