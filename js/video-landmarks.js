// Sining Kamay - video-based gesture capture: turns a recorded video Blob (and later, an
// imported File) into per-frame raw MediaPipe Hands landmarks by seeking frame-by-frame.
//
// Plain script, attaches window.VideoLandmarks (and, for the pure seekTimes() helper only,
// module.exports under node - see the bottom of this file). DOM-only otherwise (no node
// build): a detached <video>, a <canvas>, URL.createObjectURL. Knows nothing about reps,
// labels, categories or the save endpoint - it only turns a Blob into { frames, videoWidth,
// videoHeight, fps, durationMs, input } via a caller-supplied detector (see
// js/gesture-data.js's createVideoDetector()). The letterbox-fit math is NOT duplicated here
// (fix round 1, review item 5): it calls window.GestureDataRecorder.letterboxRect(), the one
// definition shared with runHandLoop's live-camera letterboxing.
(function () {
  'use strict';

  // How long a single video-element event wait (loadedmetadata, durationchange, seeked) is
  // allowed to take before extractVideoLandmarks() gives up with a clear error instead of
  // hanging forever (fix round 1, review item 2).
  var VIDEO_EVENT_TIMEOUT_MS = 15000;

  function round(n, dp) {
    var m = Math.pow(10, dp);
    return Math.round(n * m) / m;
  }

  function abortError() {
    return new DOMException('Aborted', 'AbortError');
  }

  // seekTimes(duration, fps) -> [t0, t1, ...]: the pure seek-time grid extractVideoLandmarks
  // walks. Pulled out as a pure, DOM-free helper (fix round 1) so it can be unit-tested under
  // node directly, and so the extraction loop can't drift off this exact grid: iterating
  // `for (t = 0; t < duration; t += 1/fps)` accumulates float error (e.g. duration=2, fps=15
  // gives 31 steps instead of 30 - the reviewer's off-by-one). Deriving each t as `k / fps`
  // for a fixed k in [0, total) is exact for any k.
  function seekTimes(duration, fps) {
    var total = Math.ceil(duration * fps);
    var times = new Array(total);
    for (var k = 0; k < total; k++) {
      times[k] = k / fps;
    }
    return times;
  }

  // Waits for `eventName` on `target`, rejecting on `errorEventName` (if given), on a timeout,
  // or on `signal` aborting - whichever comes first (fix round 1, review item 2: none of
  // these waits may hang forever, and an abort must be able to break one immediately rather
  // than only being noticed on the next loop iteration).
  function waitEvent(target, eventName, errorEventName, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || VIDEO_EVENT_TIMEOUT_MS;
    var signal = opts.signal || null;

    return new Promise(function (resolve, reject) {
      var settled = false;

      function cleanup() {
        target.removeEventListener(eventName, onEvent);
        if (errorEventName) target.removeEventListener(errorEventName, onError);
        if (signal) signal.removeEventListener('abort', onAbort);
        clearTimeout(timeoutId);
      }

      function onEvent() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }

      function onError(e) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e && e.error ? e.error : new Error('video error while waiting for "' + eventName + '"'));
      }

      function onAbort() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(abortError());
      }

      var timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('timed out waiting for video event "' + eventName + '" (' + timeoutMs + 'ms)'));
      }, timeoutMs);

      target.addEventListener(eventName, onEvent, { once: true });
      if (errorEventName) target.addEventListener(errorEventName, onError, { once: true });
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  // extractVideoLandmarks(source, options) -> Promise<{ frames, videoWidth, videoHeight, fps,
  // durationMs, input }>. source: Blob | File. options.detector: { reset(), detect(canvas) }.
  async function extractVideoLandmarks(source, options) {
    var opts = options || {};
    var detector = opts.detector;
    if (!detector || typeof detector.detect !== 'function' || typeof detector.reset !== 'function') {
      throw new Error('extractVideoLandmarks requires a { reset(), detect(canvas) } detector');
    }
    if (!window.GestureDataRecorder || typeof window.GestureDataRecorder.letterboxRect !== 'function') {
      throw new Error('extractVideoLandmarks requires js/gesture-data.js (window.GestureDataRecorder.letterboxRect) to be loaded');
    }
    var fps = opts.fps || (window.GestureCaptureCore && window.GestureCaptureCore.CAPTURE.PROCESS_FPS) || 15;
    var inputWidth = opts.inputWidth || 320;
    var inputHeight = opts.inputHeight || 240;
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var signal = opts.signal || null;

    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    var canvas = document.createElement('canvas');
    canvas.width = inputWidth;
    canvas.height = inputHeight;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    var objectUrl = null;

    function checkAborted() {
      if (signal && signal.aborted) {
        throw abortError();
      }
    }

    try {
      objectUrl = URL.createObjectURL(source);
      video.src = objectUrl;

      await waitEvent(video, 'loadedmetadata', 'error', { signal: signal });

      checkAborted();

      // Infinity-duration fix: MediaRecorder WebMs without cues report Infinity duration until
      // a seek beyond the (unknown) end forces the browser to resolve it via durationchange.
      if (!isFinite(video.duration)) {
        var durationChangePromise = waitEvent(video, 'durationchange', 'error', { signal: signal });
        video.currentTime = 1e101;
        await durationChangePromise;

        var seekBackPromise = waitEvent(video, 'seeked', 'error', { signal: signal });
        video.currentTime = 0;
        await seekBackPromise;
      }

      checkAborted();

      // Review item 2: the fix above isn't guaranteed to leave a usable duration (a
      // corrupt/empty file, or a browser that never fires durationchange as expected) - fail
      // clearly here rather than dividing by an unusable value further down.
      var duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        throw new Error('extractVideoLandmarks: could not determine a finite, positive video duration (got ' + duration + ')');
      }

      var videoWidth = video.videoWidth;
      var videoHeight = video.videoHeight;
      // Review item 5: a video with no video track (0x0) can't be letterboxed - fail clearly
      // instead of producing NaN rects / a black-only extraction.
      if (!videoWidth || !videoHeight) {
        throw new Error('extractVideoLandmarks: video has no video track (0x0 dimensions)');
      }
      var contentRect = window.GestureDataRecorder.letterboxRect(videoWidth, videoHeight, inputWidth, inputHeight);

      var times = seekTimes(duration, fps);
      var total = times.length;

      detector.reset();

      var frames = [];
      for (var k = 0; k < total; k++) {
        checkAborted();

        var t = times[k];
        var seekedPromise = waitEvent(video, 'seeked', 'error', { signal: signal });
        video.currentTime = t;
        await seekedPromise;

        checkAborted();

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, inputWidth, inputHeight);
        ctx.drawImage(video, contentRect.x, contentRect.y, contentRect.w, contentRect.h);

        var results = await detector.detect(canvas);

        checkAborted();

        var multiHandLandmarks = results.multiHandLandmarks || [];
        var multiHandedness = results.multiHandedness || [];
        var hands = multiHandLandmarks.map(function (landmarks, i) {
          var handedness = multiHandedness[i] || {};
          return {
            label: handedness.label,
            score: round(handedness.score || 0, 3),
            landmarks: landmarks.map(function (p) {
              return { x: round(p.x, 4), y: round(p.y, 4), z: round(p.z, 4) };
            }),
          };
        });

        frames.push({ t: Math.round(k * 1000 / fps), hands: hands });

        if (onProgress) onProgress(k + 1, total);
      }

      return {
        frames: frames,
        videoWidth: videoWidth,
        videoHeight: videoHeight,
        fps: fps,
        durationMs: Math.round(duration * 1000),
        input: { width: inputWidth, height: inputHeight, contentRect: contentRect },
      };
    } finally {
      video.removeAttribute('src');
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  var api = {
    extractVideoLandmarks: extractVideoLandmarks,
    seekTimes: seekTimes,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.VideoLandmarks = api;
  }
})();
