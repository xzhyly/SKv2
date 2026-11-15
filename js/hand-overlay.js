// js/hand-overlay.js
// The hand lines over the camera in Let's Talk (the "Guide" button), drawn so they move with the hand
// (seq-recognition phase, 2026-11-15). Before, the lines were drawn only when MediaPipe answered, so on the Pi
// (a few answers a second) they jumped from place to place and blinked off when one frame missed the hand.
// Now:
//   - MediaPipe's answers only update each hand's position and speed (feed());
//   - a requestAnimationFrame loop (at most MAX_FPS) draws the hand where it should be now: the last position
//     moved on by 70 % of its speed for the time since that camera frame was taken (at most LEAD_MS), eased toward it
//     (EASE_MS) so a new answer never makes the lines jump;
//   - a hand MediaPipe missed for a moment is kept for HOLD_MS, then fades out over FADE_MS;
//   - all lines are one path and one stroke, all dots one path and one fill (2 draw calls a frame, not 84).
// The loop stops by itself when no hand is left, so it costs nothing with no hand in view.
// Used by js/gesture-data.js when this file is loaded (talk.html, through js/talk-loader.js); without it the old
// per-answer drawing in js/gesture-data.js runs.
(function () {
  'use strict';

  var O = window.HandOverlayOpts || {};   // tests only
  var MAX_FPS = 30;
  var LEAD_MS = O.lead || 150;     // never predict further ahead than this
  var LEAD_DAMP = O.damp || 0.7;   // predict with this share of the measured speed (a hand slowing down overshoots less)
  var EASE_MS = O.ease || 45;      // time constant of the easing toward the predicted position
  var HOLD_MS = 300;     // a hand not seen keeps its last place this long
  var FADE_MS = 200;     // then fades out over this
  var BONES = [0, 1, 1, 2, 2, 3, 3, 4, 0, 5, 5, 6, 6, 7, 7, 8, 5, 9, 9, 10, 10, 11, 11, 12, 9, 13, 13, 14, 14, 15, 15, 16,
    13, 17, 0, 17, 17, 18, 18, 19, 19, 20];

  var canvas = null, ctx = null, video = null;
  var sizeKey = '';
  var tracks = [];       // { label, pts, vel, shown, t (capture time), seen (feed time), dtAvg }
  var raf = null, lastDraw = 0;
  var stats = { draws: 0, feeds: 0, drawMs: 0 };

  function on() { return window.showSkeleton !== false; }

  // Fit the canvas over the picture inside the <video> box (letterbox / pillarbox), only when a size changed.
  function fit() {
    if (!video) return;
    var vw = video.videoWidth || 320, vh = video.videoHeight || 240, cw = video.clientWidth, ch = video.clientHeight;
    var key = vw + 'x' + vh + ':' + cw + 'x' + ch;
    if (key === sizeKey) return;
    sizeKey = key;
    var w = cw, h = ch, x = 0, y = 0;
    if (vw / vh > cw / ch) { h = cw / (vw / vh); y = (ch - h) / 2; } else { w = ch * (vw / vh); x = (cw - w) / 2; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.left = x + 'px';
    canvas.style.top = y + 'px';
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
  }

  function toArray(lm) {
    var a = new Float32Array(42);
    for (var i = 0; i < 21; i++) { a[i * 2] = lm[i].x; a[i * 2 + 1] = lm[i].y; }
    return a;
  }

  // One MediaPipe answer. captureT: performance.now() when that camera frame was sent (the hand was there then).
  function feed(results, captureT, cv, vid) {
    if (!cv) return;
    if (cv !== canvas) { canvas = cv; ctx = cv.getContext('2d'); sizeKey = ''; }
    video = vid || video;
    stats.feeds++;
    var now = performance.now();
    var t = typeof captureT === 'number' ? captureT : now;
    var lms = (results && results.multiHandLandmarks) || [];
    var hd = (results && results.multiHandedness) || [];
    var used = [];
    lms.slice(0, 2).forEach(function (lm, i) {
      if (!lm || lm.length < 21) return;
      var p = toArray(lm), label = (hd[i] && hd[i].label) || '';
      // The same hand as before: same handedness, else the nearest wrist.
      var best = null, bestD = Infinity;
      tracks.forEach(function (tr) {
        if (used.indexOf(tr) >= 0) return;
        var d = Math.hypot(tr.pts[0] - p[0], tr.pts[1] - p[1]) + (tr.label === label ? 0 : 0.25);
        if (d < bestD) { bestD = d; best = tr; }
      });
      if (best && bestD < 0.5) {
        var dt = t - best.t;
        if (dt > 0 && dt < 500) {
          // A hand that slows down sharply (the end of a sign) takes its new speed at once, so the lines do not
          // run past where it stopped; otherwise the speed is smoothed over the last answers.
          var vOld = Math.hypot(best.vel[0], best.vel[1]);
          var vNew = Math.hypot((p[0] - best.pts[0]) / dt, (p[1] - best.pts[1]) / dt);
          var keep = vNew < vOld * 0.5 ? 0 : 0.4;
          for (var k = 0; k < 42; k++) best.vel[k] = best.vel[k] * keep + ((p[k] - best.pts[k]) / dt) * (1 - keep);
          best.dtAvg = best.dtAvg ? best.dtAvg * 0.8 + dt * 0.2 : dt;
        } else {
          best.vel.fill(0);
        }
        best.pts = p; best.t = t; best.seen = now; best.label = label;
        used.push(best);
      } else {
        var tr = { label: label, pts: p, vel: new Float32Array(42), shown: p.slice(), t: t, seen: now, dtAvg: 0 };
        tracks.push(tr);
        used.push(tr);
      }
    });
    if (!raf && tracks.length && on()) { lastDraw = 0; raf = requestAnimationFrame(frame); }
  }

  function frame(now) {
    raf = null;
    if (!canvas || !on()) { clear(); return; }
    tracks = tracks.filter(function (tr) { return now - tr.seen < HOLD_MS + FADE_MS; });
    if (!tracks.length) { clear(); return; }
    raf = requestAnimationFrame(frame);
    if (lastDraw && now - lastDraw < 1000 / MAX_FPS - 3) return;
    var step = lastDraw ? now - lastDraw : 1000;
    lastDraw = now;
    var t0 = performance.now();
    fit();
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var ease = 1 - Math.exp(-step / EASE_MS);
    var groups = [];   // hands by opacity (normally one group)
    tracks.forEach(function (tr) {
      var missing = now - tr.seen;
      var lead = missing > HOLD_MS ? 0 : Math.min(now - tr.t, LEAD_MS) * LEAD_DAMP;
      for (var k = 0; k < 42; k++) tr.shown[k] += (tr.pts[k] + tr.vel[k] * lead - tr.shown[k]) * ease;
      var alpha = missing <= HOLD_MS ? 1 : Math.max(0, 1 - (missing - HOLD_MS) / FADE_MS);
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].alpha === alpha) g = groups[i];
      if (!g) { g = { alpha: alpha, list: [] }; groups.push(g); }
      g.list.push(tr.shown);
    });
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = '#f97316';
    groups.forEach(function (g) {
      ctx.globalAlpha = g.alpha;
      ctx.beginPath();
      g.list.forEach(function (s) {
        for (var b = 0; b < BONES.length; b += 2) {
          ctx.moveTo(s[BONES[b] * 2] * W, s[BONES[b] * 2 + 1] * H);
          ctx.lineTo(s[BONES[b + 1] * 2] * W, s[BONES[b + 1] * 2 + 1] * H);
        }
      });
      ctx.stroke();
      ctx.beginPath();
      g.list.forEach(function (s) {
        for (var j = 0; j < 21; j++) {
          var x = s[j * 2] * W, y = s[j * 2 + 1] * H;
          ctx.moveTo(x + 5, y);
          ctx.arc(x, y, 5, 0, 2 * Math.PI);
        }
      });
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    stats.draws++;
    stats.drawMs += performance.now() - t0;
  }

  // Removes the lines at once (leaving the camera, Guide off).
  function clear() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    tracks = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Debug (?devperf) and tests: draws and feeds since the last call, mean draw time.
  function getStats() {
    var o = { draws: stats.draws, feeds: stats.feeds, drawMs: stats.draws ? stats.drawMs / stats.draws : 0, hands: tracks.length };
    stats = { draws: 0, feeds: 0, drawMs: 0 };
    return o;
  }

  window.HandOverlay = { feed: feed, clear: clear, getStats: getStats, running: function () { return !!raf; },
    _shown: function () { return tracks.map(function (tr) { return Array.from(tr.shown); }); } };
})();
