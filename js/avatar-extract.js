// js/avatar-extract.js
// Video File -> raw avatar clip frames with MediaPipe Holistic (vendored, js/lib/holistic/), for
// avatar-clips.html ONLY: Holistic is never loaded on the kiosk's Let's Talk screens (decision 2).
// The video is read in the browser through an object URL; it is never uploaded or stored
// (decision 4). Walks the exact k/fps seek grid of js/video-landmarks.js's seekTimes() (that file
// is reused, not changed). Each frame is drawn into a canvas of at most 720 px (long side) before
// send(), as js/gesture-data.js sends a canvas rather than the <video> (step 1 report Q15).
(function () {
  'use strict';

  var FPS = 25;
  var MAX_SIDE = 720;
  var EVENT_TIMEOUT_MS = 15000;
  var LIB = 'js/lib/holistic/';
  var MAX_SECONDS = 60;   // a clip holds at most 500 frames (20 s); longer videos are refused up front

  // Only the SIMD build of Holistic is vendored (owner decision at Step 1 approval). The 31-byte
  // module is the standard WebAssembly SIMD feature test (one v128 instruction).
  function simdSupported() {
    try {
      return typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) {
      return false;
    }
  }

  function abortError() { return new DOMException('Aborted', 'AbortError'); }

  function waitEvent(target, name, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(abortError()); return; }
      var timer = setTimeout(function () { done(); reject(new Error('Timed out waiting for the video (' + name + ')')); }, EVENT_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        target.removeEventListener(name, onOk);
        target.removeEventListener('error', onErr);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      function onOk() { done(); resolve(); }
      function onErr() { done(); reject(new Error('This video cannot be read by the browser')); }
      function onAbort() { done(); reject(abortError()); }
      target.addEventListener(name, onOk);
      target.addEventListener('error', onErr);
      if (signal) signal.addEventListener('abort', onAbort);
    });
  }

  function createExtractor() {
    var holistic = null;
    var ready = null;
    var last = null;

    function init() {
      if (ready) return ready;
      if (!simdSupported()) return Promise.reject(new Error('NO_SIMD'));
      if (typeof window.Holistic !== 'function') return Promise.reject(new Error('Holistic library not loaded'));
      holistic = new window.Holistic({ locateFile: function (f) { return LIB + f; } });
      holistic.setOptions({
        modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, refineFaceLandmarks: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
      });
      holistic.onResults(function (r) { last = r; });
      ready = Promise.resolve(holistic.initialize ? holistic.initialize() : null).catch(function (e) {
        ready = null;
        throw e;
      });
      return ready;
    }

    // file: a video File/Blob. opts: {video (an <video> to use, kept for display afterwards),
    // onFrame(index, total, results, canvas), signal}. Resolves {frames, fps, video:{w,h,durationMs}}.
    // opts.range {startMs, endMs} (bulk import): only the grid times k/FPS with
    // startMs <= k*1000/FPS <= endMs are sought; onFrame then counts within the range and the
    // result also has firstFrame (the k of frames[0]; null when the range holds no grid time).
    async function extract(file, opts) {
      opts = opts || {};
      var signal = opts.signal || null;
      await init();
      if (signal && signal.aborted) throw abortError();
      var video = opts.video || document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      if (video.src && video.src.indexOf('blob:') === 0) URL.revokeObjectURL(video.src);
      video.src = URL.createObjectURL(file);
      await waitEvent(video, 'loadedmetadata', signal);
      if (!isFinite(video.duration)) {          // MediaRecorder WebM without cues
        var dc = waitEvent(video, 'durationchange', signal);
        video.currentTime = 1e101;
        await dc;
        var back = waitEvent(video, 'seeked', signal);
        video.currentTime = 0;
        await back;
      }
      var duration = video.duration;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!isFinite(duration) || duration <= 0 || !vw || !vh) throw new Error('This video has no readable picture');
      if (duration > MAX_SECONDS) throw new Error('This video is ' + Math.round(duration) + ' s long; use one sign, under ' + MAX_SECONDS + ' s');
      var sc = Math.min(1, MAX_SIDE / Math.max(vw, vh));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * sc);
      canvas.height = Math.round(vh * sc);
      var ctx = canvas.getContext('2d');
      var times = window.VideoLandmarks.seekTimes(duration, FPS);
      if (times.length > 0 && times[times.length - 1] >= duration) times[times.length - 1] = Math.max(0, duration - 0.001);
      var first = 0, end = times.length;   // the grid indices walked: first .. end - 1
      if (opts.range) {
        if (!isFinite(opts.range.startMs) || !isFinite(opts.range.endMs) || opts.range.startMs === null || opts.range.endMs === null) {
          throw new Error('range needs startMs and endMs');
        }
        while (first < end && first * 1000 / FPS < opts.range.startMs) first++;
        while (end > first && (end - 1) * 1000 / FPS > opts.range.endMs) end--;
      }
      if (holistic.reset) holistic.reset();
      var frames = [];
      for (var k = first; k < end; k++) {
        if (signal && signal.aborted) throw abortError();
        var seeked = waitEvent(video, 'seeked', signal);
        video.currentTime = times[k];
        await seeked;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        last = null;
        await holistic.send({ image: canvas });
        var r = last || {};
        frames.push(window.AvatarClip.packFrame(r));
        if (opts.onFrame) opts.onFrame(k - first, end - first, r, canvas);
      }
      var out = { frames: frames, fps: FPS, video: { w: vw, h: vh, durationMs: Math.round(duration * 1000) } };
      if (opts.range) out.firstFrame = frames.length ? first : null;
      return out;
    }

    return { init: init, extract: extract };
  }

  window.AvatarExtract = { simdSupported: simdSupported, createExtractor: createExtractor, FPS: FPS };
})();
