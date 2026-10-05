// js/avatar-player.js
// Plays a list of prepared clips on the avatar canvas as one continuous movement
// (js/avatar-timeline.js): rest -> sign 1 -> blend -> sign 2 ... -> rest. requestAnimationFrame
// loop capped at 30 fps; between playbacks nothing runs (the canvas keeps the rest pose).
// onStart / onEnd let the page pause hand tracking while the avatar plays (decision 10).
(function () {
  'use strict';

  function create(opts) {
    var rig = opts.rig || window.AvatarRig;
    var renderer = window.AvatarRenderer.create(opts.canvas, opts.parts, { rig: rig, view: opts.view });
    var fpsCap = opts.fpsCap === undefined ? 30 : opts.fpsCap;   // 0 = draw on every animation frame
    var raf = null;
    var current = null;   // { resolve, onWord, tl, t0, word, stats }
    var restPose = window.AvatarRetarget.restPose(rig);

    function now() { return performance.now(); }

    function finish(completed) {
      if (!current) return;
      var c = current;
      current = null;
      clearTimeout(c.safety);
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      renderer.draw(restPose, now());
      c.stats.endedAt = now();
      try { if (opts.onEnd) opts.onEnd(); } catch (e) { console.error('[avatar] onEnd failed:', e); }
      c.resolve({ completed: completed, stats: c.stats });
    }

    function frame() {
      raf = null;
      if (!current) return;
      var c = current;
      var t = now();
      var minGap = fpsCap ? 1000 / fpsCap - 4 : 0;
      if (!c.lastDraw || t - c.lastDraw >= minGap) {
        var ms = t - c.t0;
        var s = c.tl.poseAt(Math.min(ms, c.tl.duration));
        if (s.word !== c.word && s.word >= 0) {
          c.word = s.word;
          try { if (c.onWord) c.onWord(s.word); } catch (e) { console.error('[avatar] onWord failed:', e); }
          if (current !== c) return;     // onWord cancelled or restarted the player
        }
        var a = now();
        renderer.draw(s.pose, t);
        var drawMs = now() - a;
        if (c.lastDraw) c.stats.intervals.push(t - c.lastDraw);
        c.stats.drawMs.push(drawMs);
        c.lastDraw = t;
        if (ms >= c.tl.duration) { finish(true); return; }
      }
      if (current === c) raf = requestAnimationFrame(frame);
    }

    // preps: prepared clips (js/avatar-store.js load()). Resolves {completed, stats} when the
    // timeline has played to rest, or {completed:false} after cancel().
    function play(preps, playOpts) {
      cancel();
      playOpts = playOpts || {};
      var tl = window.AvatarTimeline.build(preps, rig);
      return new Promise(function (resolve) {
        current = {
          resolve: resolve, onWord: playOpts.onWord, tl: tl, t0: now(), word: -1, lastDraw: 0,
          stats: { startedAt: now(), duration: tl.duration, intervals: [], drawMs: [] }
        };
        try { if (opts.onStart) opts.onStart(); } catch (e) { console.error('[avatar] onStart failed:', e); }
        // Safety net: rAF stops in a hidden tab; never leave hand tracking paused for good.
        var mine = current;
        mine.safety = setTimeout(function () { if (current === mine) finish(true); }, tl.duration + 2000);
        raf = requestAnimationFrame(frame);
      });
    }

    function cancel() { if (current) finish(false); }
    function isPlaying() { return !!current; }
    function showRest() { renderer.draw(restPose, now()); }

    return { play: play, cancel: cancel, isPlaying: isPlaying, showRest: showRest, renderer: renderer };
  }

  window.AvatarPlayer = { create: create };
})();
