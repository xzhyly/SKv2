// Sining Kamay - video-based gesture capture: turns a recorded video Blob (and later, an
// imported File) into per-frame raw MediaPipe Hands landmarks by seeking frame-by-frame.
//
// Plain script, attaches window.VideoLandmarks. DOM-only (no node build): a detached <video>,
// an <canvas>, URL.createObjectURL. Knows nothing about reps, labels, categories or the save
// endpoint - it only turns a Blob into { frames, videoWidth, videoHeight, fps, durationMs,
// input } via a caller-supplied detector (see js/gesture-data.js's createVideoDetector()).
(function () {
  'use strict';

  function round(n, dp) {
    var m = Math.pow(10, dp);
    return Math.round(n * m) / m;
  }

  // Same fit-within-box letterbox math as runHandLoop (js/gesture-data.js:374-398): fits the
  // video's native aspect ratio inside inputWidth x inputHeight, centered, black-filled bars.
  function computeContentRect(vWidth, vHeight, targetWidth, targetHeight) {
    var videoRatio = vWidth / vHeight;
    var targetRatio = targetWidth / targetHeight;

    var dWidth = targetWidth;
    var dHeight = targetHeight;
    var dx = 0;
    var dy = 0;

    if (videoRatio > targetRatio) {
      dHeight = targetWidth / videoRatio;
      dy = (targetHeight - dHeight) / 2;
    } else {
      dWidth = targetHeight * videoRatio;
      dx = (targetWidth - dWidth) / 2;
    }

    return { x: dx, y: dy, w: dWidth, h: dHeight };
  }

  function waitEvent(target, eventName, errorEventName) {
    return new Promise(function (resolve, reject) {
      function onEvent() {
        if (errorEventName) target.removeEventListener(errorEventName, onError);
        resolve();
      }
      function onError(e) {
        target.removeEventListener(eventName, onEvent);
        reject(e && e.error ? e.error : new Error('video error during load'));
      }
      target.addEventListener(eventName, onEvent, { once: true });
      if (errorEventName) target.addEventListener(errorEventName, onError, { once: true });
    });
  }

  function abortError() {
    return new DOMException('Aborted', 'AbortError');
  }

  // extractVideoLandmarks(source, options) -> Promise<{ frames, videoWidth, videoHeight, fps,
  // durationMs, input }>. source: Blob | File. options.detector: { reset(), detect(canvas) }.
  async function extractVideoLandmarks(source, options) {
    var opts = options || {};
    var detector = opts.detector;
    if (!detector || typeof detector.detect !== 'function' || typeof detector.reset !== 'function') {
      throw new Error('extractVideoLandmarks requires a { reset(), detect(canvas) } detector');
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

      var loadedMetadata = waitEvent(video, 'loadedmetadata', 'error');
      await loadedMetadata;

      checkAborted();

      // Infinity-duration fix: MediaRecorder WebMs without cues report Infinity duration until
      // a seek beyond the (unknown) end forces the browser to resolve it via durationchange.
      if (!isFinite(video.duration)) {
        var durationChange = waitEvent(video, 'durationchange', 'error');
        video.currentTime = 1e101;
        await durationChange;
        var seekBack = waitEvent(video, 'seeked', 'error');
        video.currentTime = 0;
        await seekBack;
      }

      checkAborted();

      var duration = video.duration;
      var videoWidth = video.videoWidth;
      var videoHeight = video.videoHeight;
      var contentRect = computeContentRect(videoWidth, videoHeight, inputWidth, inputHeight);
      var total = Math.ceil(duration * fps);

      detector.reset();

      var frames = [];
      var k = 0;
      for (var t = 0; t < duration; t += 1 / fps, k++) {
        checkAborted();

        var seeked = waitEvent(video, 'seeked', 'error');
        video.currentTime = t;
        await seeked;

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
      video.src = '';
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  window.VideoLandmarks = {
    extractVideoLandmarks: extractVideoLandmarks,
  };
})();
