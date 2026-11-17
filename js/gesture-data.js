(function () {
  // v2 capture was capped at 30 frames (the removed FRAME_TARGET); this keeps a long v3 rep from
  // outweighing v2 samples in knnPredict's top-5 mean; the keyframes phase replaces it.
  const MAX_ROWS_PER_RAW_SAMPLE = 30;
  const SAVE_ENDPOINT = (location.protocol === "file:")
    ? "http://localhost/Sining_kamay/php/api/save_gesture.php"
    : "php/api/save_gesture.php";
  const SIGNS_ENDPOINT = (location.protocol === "file:")
    ? "http://localhost/Sining_kamay/php/api/signs.php"
    : "php/api/signs.php";

  // One-time model-schema reset. "2" (sign-texts phase): ESL/FSL models include BOTH signs and key
  // off the sign's set, so every cached model and label list was dropped once. "3" (compact-model
  // phase): the model is the compiled file models/knn_<LANG>.bin, cached in IndexedDB
  // (js/knn-model-store.js), so the old localStorage copies (about 3.4M characters) are dropped once.
  (function resetModelSchemaOnce() {
    try {
      if (localStorage.getItem("sining_kamay_model_schema") === "3") return;
      ["sining_kamay_knn_ESL", "sining_kamay_knn_FSL",
        "sining_kamay_labels_ESL", "sining_kamay_labels_FSL",
        "sining_kamay_trained_labels_ESL", "sining_kamay_trained_labels_FSL"
      ].forEach((k) => { localStorage.removeItem(k); });
      localStorage.setItem("sining_kamay_model_schema", "3");
    } catch (e) { /* storage blocked: nothing cached to reset */ }
  })();

  const state = {
    hands: null,
    cameraLoop: null,
    latestLandmarks: null,
    processingVideo: false,
    loopPaused: false,
    sendInFlight: false,
    video: null,
    toast: null,
    savedCategories: { ESL: {}, FSL: {} }, // last loadSavedGestureDataset()'s json.categories
    signs: {}, // key -> { set, textEn, textFil }: last loadSavedGestureDataset()'s json.signs / loadSigns()
    modelSigns: Object.create(null), // key -> { set, textEn, textFil }: from model file headers (setModelSigns)
    // Video-based gesture capture (createVideoDetector / onHandResults, js/video-landmarks.js):
    detectorMode: false, // true while a createVideoDetector() detector "owns" onResults
    pendingDetectResolve: null, // resolves the in-flight detect(canvas) promise
    pendingDetectReject: null, // rejects the in-flight detect(canvas) promise
    detectorSendPending: false, // true from the moment detect() calls hands.send() until that
    // specific call has been accounted for (onResults arrived, or its send() promise itself
    // settled without one) - lets release() know a late onResults is still owed and must be
    // discarded rather than routed to the live path (fix round 1, review items 3/4).
    detectorFinishReleaseIfReady: null, // set by the active detector's release(); called once
    // detectorSendPending clears, so a release requested mid-send can finish once it's safe.
    handSubscribers: [], // onHandResults() subscribers, called with (results) outside detector mode
    // Live-loop options (pi-fixes 2026-10-21, setLoopOptions()). Defaults = the behaviour before:
    // every animation frame is sent, full landmark model. talk.html sets detectEvery 2 and the lite
    // model so the Pi's main thread is not busy with MediaPipe all the time.
    loopOpts: { detectEvery: 1, modelComplexity: 1 },
    frameCounter: 0, // video frames seen by the requestVideoFrameCallback loop (detectEvery > 1)
    stats: { since: 0, videoFrames: 0, detections: 0, detectMs: 0, lastQualityFrames: null },
  };

  // letterboxRect(srcW, srcH, dstW, dstH) -> { x, y, w, h }: fits a srcW x srcH box centered
  // inside a dstW x dstH box, preserving aspect ratio (the black-bar "letterbox/pillarbox"
  // fit). ONE definition shared by runHandLoop (live camera -> 320x240) and
  // js/video-landmarks.js's extractVideoLandmarks (recorded video -> caller-chosen size) so
  // the two can never diverge (fix round 1, review item 5). Callers own their own fallback
  // for a zero/unknown srcW/srcH (runHandLoop's `|| 320` / `|| 240`) - this function does not
  // guess a default.
  function letterboxRect(srcW, srcH, dstW, dstH) {
    const srcRatio = srcW / srcH;
    const dstRatio = dstW / dstH;

    let w = dstW;
    let h = dstH;
    let x = 0;
    let y = 0;

    if (srcRatio > dstRatio) {
      h = dstW / srcRatio;
      y = (dstH - h) / 2;
    } else {
      w = dstH * srcRatio;
      x = (dstW - w) / 2;
    }

    return { x, y, w, h };
  }

  function notify(message) {
    if (typeof window.showToast === "function") {
      window.showToast(message);
      return;
    }
    if (!state.toast) {
      const el = document.createElement("div");
      el.id = "gesture-data-toast";
      el.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:24px",
        "transform:translateX(-50%)",
        "z-index:99999",
        "max-width:calc(100vw - 32px)",
        "padding:10px 14px",
        "border-radius:8px",
        "background:#222",
        "color:#fff",
        "font:600 13px system-ui,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,.22)",
        "opacity:0",
        "transition:opacity .18s",
      ].join(";");
      document.body.appendChild(el);
      state.toast = el;
    }
    state.toast.textContent = message;
    state.toast.style.opacity = "1";
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      state.toast.style.opacity = "0";
    }, 2400);
  }

  function cleanLabel(label) {
    return String(label || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/^[_-]+|[_-]+$/g, "");
  }

  function flattenHand(hand) {
    if (!Array.isArray(hand) || hand.length < 21) {
      return Array(63).fill(0);
    }
    const wrist = hand[0];
    const normalized = hand.map((point) => ({
      x: (Number(point.x) || 0) - (Number(wrist.x) || 0),
      y: (Number(point.y) || 0) - (Number(wrist.y) || 0),
      z: (Number(point.z) || 0) - (Number(wrist.z) || 0),
    }));
    const scale = Math.max(
      ...normalized.map((point) => Math.hypot(point.x, point.y, point.z)),
      0.0001
    );
    const out = [];
    normalized.forEach((point) => {
      out.push(point.x / scale, point.y / scale, point.z / scale);
    });
    return out;
  }

  function flattenLandmarks(hands) {
    if (!Array.isArray(hands) || hands.length === 0) {
      return Array(126).fill(0);
    }
    if (typeof hands[0] === 'number') {
      if (hands.length === 126) return hands;
      if (hands.length === 63) return hands.concat(Array(63).fill(0));
      return hands;
    }
    const hand1 = flattenHand(hands[0]);
    const hand2 = hands.length >= 2 ? flattenHand(hands[1]) : Array(63).fill(0);
    return hand1.concat(hand2);
  }

  function normalizeLandmarks(handsArray) {
    if (!Array.isArray(handsArray) || handsArray.length === 0) return null;
    if (typeof handsArray[0] === 'number') return handsArray;
    if (handsArray.length === 21 && typeof handsArray[0] === 'object' && !Array.isArray(handsArray[0])) {
      handsArray = [handsArray];
    }
    return handsArray.map((hand) => {
      if (!Array.isArray(hand)) return [];
      return hand.map((point) => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
        z: Number(point.z) || 0,
      }));
    });
  }

  function getLatestLandmarks() {
    return (state.latestLandmarks && state.latestLandmarks.length > 0) 
      ? normalizeLandmarks(state.latestLandmarks) 
      : null;
  }

  function getRawWristPosition() {
    if (!state.latestLandmarks || !state.latestLandmarks.length) return null;
    var w0 = state.latestLandmarks[0] && state.latestLandmarks[0][0];
    if (!w0) return null;
    if (state.latestLandmarks.length === 1) {
      return { x: Number(w0.x) || 0, y: Number(w0.y) || 0 };
    }
    var w1 = state.latestLandmarks[1] && state.latestLandmarks[1][0];
    if (!w1) return { x: Number(w0.x) || 0, y: Number(w0.y) || 0 };
    return {
      x: ((Number(w0.x) || 0) + (Number(w1.x) || 0)) / 2,
      y: Math.min(Number(w0.y) || 0, Number(w1.y) || 0)
    };
  }

  function extractLandmarkFeatures() {
    return flattenLandmarks(getLatestLandmarks());
  }

  async function setupMediaPipe(video) {
    if (!window.Hands) {
      notify("MediaPipe Hands is not loaded. Landmark recording is disabled.");
      return false;
    }

    const targetVideo = video || document.getElementById("videoFeed") || document.getElementById("video");
    if (!targetVideo) {
      notify("No camera video element found.");
      return false;
    }
    if (state.hands && state.video === targetVideo) {
      return true;
    }
    cancelScheduled();
    state.video = targetVideo;

    // Force non-SIMD WebAssembly on Raspberry Pi to prevent "memory access out of bounds" crashes.
    // MediaPipe internally calls ed() to detect SIMD support. We patch the WebAssembly.validate
    // function to intercept SIMD WASM files and report them as invalid, forcing fallback to
    // the stable non-SIMD binary (hands_solution_wasm_bin.wasm).
    if (!window._simdOverrideApplied) {
      window._simdOverrideApplied = true;
      const origValidate = WebAssembly.validate;
      WebAssembly.validate = function(buffer) {
        try {
          const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
          // SIMD detection: WebAssembly SIMD uses opcode 0xFD. If present at start, it's SIMD.
          // We return false to force MediaPipe to use the non-SIMD fallback.
          if (bytes.length < 1000) {
            for (let i = 0; i < Math.min(bytes.length, 256); i++) {
              if (bytes[i] === 0xFD) {
                console.log('[gesture-data] SIMD WASM detected — forcing non-SIMD fallback for Pi stability.');
                return false;
              }
            }
          }
        } catch(e) { /* ignore */ }
        return origValidate.call(WebAssembly, buffer);
      };
    }

    if (state.hands) {
      try {
        state.hands.close();
      } catch (e) {
        console.warn('[gesture-data] Failed to close old MediaPipe Hands instance:', e);
      }
      state.hands = null;
    }

    state.hands = new window.Hands({
      locateFile: (file) => {
        // Force non-SIMD: redirect SIMD binary requests to stable non-SIMD version
        const safeFile = file.includes('simd')
          ? file.replace('simd_wasm_bin', 'wasm_bin')
          : file;
        return `js/lib/mediapipe/${safeFile}`;
      },
    });
    state.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: state.loopOpts.modelComplexity,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });
    state.hands.onResults((results) => {
      // Video-based gesture capture: while a createVideoDetector() detector owns onResults,
      // route results straight to the pending detect(canvas) promise and stop - no
      // latestLandmarks update, no skeleton drawing (owner brief, Task 4).
      if (state.detectorMode) {
        // This result settles the one outstanding hands.send() call detect() issued. If a
        // detect() promise is still waiting for it, resolve it; otherwise it already
        // timed out or release() already rejected it, so this result is late - it is
        // discarded here, never routed to the live path below (fix round 1, review item 3).
        state.detectorSendPending = false;
        const resolve = state.pendingDetectResolve;
        state.pendingDetectResolve = null;
        state.pendingDetectReject = null;
        if (resolve) resolve(results);
        if (typeof state.detectorFinishReleaseIfReady === 'function') {
          state.detectorFinishReleaseIfReady();
        }
        return;
      }

      const hands = results.multiHandLandmarks || [];
      state.latestLandmarks = hands.length > 0 ? hands : null;

      state.handSubscribers.forEach((fn) => {
        try {
          fn(results);
        } catch (e) {
          console.warn('[gesture-data] onHandResults subscriber threw:', e);
        }
      });

      // Draw skeleton on tlCanvas1 if it exists (active in translation screen)
      const canvas = document.getElementById('tlCanvas1');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Adjust canvas bounding box to match the letterboxed/pillarboxed video content box exactly
          if (state.video) {
            const vWidth = state.video.videoWidth || 320;
            const vHeight = state.video.videoHeight || 240;
            const cWidth = state.video.clientWidth;
            const cHeight = state.video.clientHeight;
            
            const videoRatio = vWidth / vHeight;
            const containerRatio = cWidth / cHeight;
            
            let dWidth = cWidth;
            let dHeight = cHeight;
            let dx = 0;
            let dy = 0;
            
            if (videoRatio > containerRatio) {
              // Video is wider than container: fit to width, pad height
              dHeight = cWidth / videoRatio;
              dy = (cHeight - dHeight) / 2;
            } else {
              // Video is taller than container: fit to height, pad width
              dWidth = cHeight * videoRatio;
              dx = (cWidth - dWidth) / 2;
            }
            
            // Set canvas styles to overlap only the active video content
            canvas.style.width = `${dWidth}px`;
            canvas.style.height = `${dHeight}px`;
            canvas.style.left = `${dx}px`;
            canvas.style.top = `${dy}px`;
            
            // Sync resolution
            const roundedW = Math.round(dWidth);
            const roundedH = Math.round(dHeight);
            if (canvas.width !== roundedW || canvas.height !== roundedH) {
              canvas.width = roundedW;
              canvas.height = roundedH;
            }
          } else {
            if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
              canvas.width = canvas.clientWidth;
              canvas.height = canvas.clientHeight;
            }
          }
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          if (hands.length > 0 && window.showSkeleton !== false) {
            const HAND_CONNECTIONS = [
              [0, 1], [1, 2], [2, 3], [3, 4],         // thumb
              [0, 5], [5, 6], [6, 7], [7, 8],         // index
              [5, 9], [9, 10], [10, 11], [11, 12],     // middle
              [9, 13], [13, 14], [14, 15], [15, 16],   // ring
              [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // pinky
            ];
            
            hands.forEach((hand) => {
              // Draw connections (Green lines)
              ctx.strokeStyle = '#10b981';
              ctx.lineWidth = 3.5;
              ctx.lineCap = 'round';
              HAND_CONNECTIONS.forEach(([start, end]) => {
                const ptStart = hand[start];
                const ptEnd = hand[end];
                if (ptStart && ptEnd) {
                  ctx.beginPath();
                  ctx.moveTo(ptStart.x * canvas.width, ptStart.y * canvas.height);
                  ctx.lineTo(ptEnd.x * canvas.width, ptEnd.y * canvas.height);
                  ctx.stroke();
                }
              });
              
              // Draw joints (Orange dots)
              ctx.fillStyle = '#f97316';
              hand.forEach((pt) => {
                ctx.beginPath();
                ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
                ctx.fill();
              });
            });
          }
        }
      }
    });

    runHandLoop();
    return true;
  }

  // Shared offscreen canvas to workaround Raspberry Pi Chromium video GPU SharedImage mailbox bugs
  // Forced to 320x240 to prevent WebAssembly OOM (memory access out of bounds) crashes
  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = 320;
  offscreenCanvas.height = 240;
  const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

  // Scheduling (pi-fixes 2026-10-21). detectEvery 1: the next animation frame, as before. detectEvery
  // N > 1 (and requestVideoFrameCallback available): the loop waits for real camera frames and sends
  // only every Nth one, so the video keeps playing at the camera's rate while MediaPipe runs at 1/N
  // of it. state.cameraLoop is { kind, id } while a callback is pending, else null.
  function useVideoFrames() {
    return state.loopOpts.detectEvery > 1 && state.video &&
      typeof state.video.requestVideoFrameCallback === "function";
  }
  function scheduleNext() {
    if (useVideoFrames()) {
      const video = state.video;
      state.cameraLoop = { kind: "rvfc", video, id: video.requestVideoFrameCallback(onVideoFrame) };
    } else {
      state.cameraLoop = { kind: "raf", id: requestAnimationFrame(runHandLoop) };
    }
  }
  function cancelScheduled() {
    const c = state.cameraLoop;
    if (!c) return;
    if (c.kind === "rvfc") {
      try { c.video.cancelVideoFrameCallback(c.id); } catch (e) { /* video gone */ }
    } else {
      cancelAnimationFrame(c.id);
    }
    state.cameraLoop = null;
  }
  function onVideoFrame() {
    state.cameraLoop = null;
    state.stats.videoFrames++;
    state.frameCounter++;
    if (state.loopPaused) return;
    if (state.frameCounter % state.loopOpts.detectEvery !== 0) { scheduleNext(); return; }
    runHandLoop();
  }

  async function runHandLoop() {
    if (!state.hands || !state.video) return;
    if (state.loopPaused) {
      state.cameraLoop = null;
      return;
    }
    // Entered via a callback (or directly): what is left in cameraLoop is stale, so clear it. That
    // keeps resumeHandLoop()'s "is a callback pending?" test accurate; this iteration re-sets it before
    // returning to the event loop, except while awaiting a send (sendInFlight covers that).
    state.cameraLoop = null;
    if (state.processingVideo) {
      scheduleNext();
      return;
    }
    if (state.video.readyState >= 2) {
      try {
        // Draw video frame to 2D Canvas context preserving aspect ratio (fit within 320x240)
        const vWidth = state.video.videoWidth || 320;
        const vHeight = state.video.videoHeight || 240;
        const targetWidth = 320;
        const targetHeight = 240;

        const contentRect = letterboxRect(vWidth, vHeight, targetWidth, targetHeight);

        offscreenCtx.fillStyle = '#000';
        offscreenCtx.fillRect(0, 0, targetWidth, targetHeight);
        offscreenCtx.drawImage(state.video, contentRect.x, contentRect.y, contentRect.w, contentRect.h);

        // Send canvas (rather than raw video) to bypass Chromium mailbox crashes
        state.sendInFlight = true;
        const t0 = performance.now();
        await state.hands.send({ image: offscreenCanvas });
        state.stats.detections++;
        state.stats.detectMs += performance.now() - t0;
      } catch (err) {
        console.warn("[gesture-data] MediaPipe frame skipped:", err);
      } finally {
        state.sendInFlight = false;
      }
    }
    // Paused while awaiting: stop here. resumeHandLoop() while a send is still in flight does
    // not start a second loop; this iteration sees loopPaused === false and carries on.
    if (state.loopPaused) {
      state.cameraLoop = null;
      return;
    }
    scheduleNext();
  }

  // Additive (signing-screen merge, docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md):
  // "Stop the loop, not the object." pauseHandLoop() stops sending frames but keeps the
  // Hands instance (and its ~15MB of WASM). resumeHandLoop() restarts frames on the same
  // instance. Both drop the last landmarks so a stale hand from before a pause is never
  // classified after resume.
  function pauseHandLoop() {
    state.loopPaused = true;
    cancelScheduled();
    state.latestLandmarks = null;
  }

  function resumeHandLoop() {
    if (!state.hands || !state.video) return;
    state.loopPaused = false;
    state.latestLandmarks = null;
    // Idempotent: a pending rAF or an in-flight send means a loop is already alive and will
    // carry on by itself; only start one when nothing is running.
    if (!state.cameraLoop && !state.sendInFlight) runHandLoop();
  }

  // setLoopOptions({ detectEvery, modelComplexity }) (pi-fixes 2026-10-21): detectEvery N sends every
  // Nth camera frame to MediaPipe (1 = every animation frame, the default); modelComplexity 0 = lite
  // landmark model (needs js/lib/mediapipe/hand_landmark_lite.tflite), 1 = full (default). Safe before
  // or after setupMediaPipe(); a running loop picks the new values up at its next frame.
  function setLoopOptions(opts) {
    opts = opts || {};
    if (opts.detectEvery != null) state.loopOpts.detectEvery = Math.max(1, Math.round(Number(opts.detectEvery)) || 1);
    if (opts.modelComplexity != null && Number(opts.modelComplexity) !== state.loopOpts.modelComplexity) {
      state.loopOpts.modelComplexity = Number(opts.modelComplexity) === 0 ? 0 : 1;
      if (state.hands) state.hands.setOptions({ modelComplexity: state.loopOpts.modelComplexity });
    }
    return Object.assign({}, state.loopOpts);
  }

  // getLoopStats() -> { videoFps, detectFps, detectMs, detectEvery, modelComplexity } since the last
  // call (debug overlay / console, talk.html?devperf). videoFps counts the camera frames the <video>
  // presented (requestVideoFrameCallback loop, else getVideoPlaybackQuality()).
  function getLoopStats() {
    const now = performance.now();
    const st = state.stats;
    const secs = st.since ? (now - st.since) / 1000 : 0;
    let videoFrames = st.videoFrames;
    if (!useVideoFrames() && state.video && typeof state.video.getVideoPlaybackQuality === "function") {
      const total = state.video.getVideoPlaybackQuality().totalVideoFrames;
      videoFrames = st.lastQualityFrames == null ? 0 : total - st.lastQualityFrames;
      st.lastQualityFrames = total;
    }
    const out = {
      videoFps: secs > 0 ? videoFrames / secs : 0,
      detectFps: secs > 0 ? st.detections / secs : 0,
      detectMs: st.detections ? st.detectMs / st.detections : 0,
      detectEvery: state.loopOpts.detectEvery,
      modelComplexity: state.loopOpts.modelComplexity,
    };
    st.since = now;
    st.videoFrames = 0;
    st.detections = 0;
    st.detectMs = 0;
    return out;
  }

  // Creates the ONE Hands instance early (talk.html's loading queue) and forces its WASM +
  // model to load now via initialize(), with the frame loop left paused until the camera
  // is actually on. Reuses setupMediaPipe, so it goes through the same non-SIMD patch and
  // is idempotent for the same video element (setupMediaPipe returns early).
  // opts.warmUp (pi-fixes 2026-10-21, talk.html): also run one blank frame through the graph, so the
  // first-inference cost (measured ~0.9 s on the laptop) is paid in the loading queue, not while the
  // camera overlay is up. Its (empty) result only clears latestLandmarks.
  async function preloadMediaPipe(video, opts) {
    const ok = await setupMediaPipe(video);
    if (!ok || !state.hands) return false;
    pauseHandLoop();
    await state.hands.initialize();
    if (opts && opts.warmUp) {
      offscreenCtx.fillStyle = "#000";
      offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      try {
        state.sendInFlight = true;
        await state.hands.send({ image: offscreenCanvas });
      } catch (e) {
        console.warn("[gesture-data] MediaPipe warm-up frame failed:", e);
      } finally {
        state.sendInFlight = false;
      }
      state.latestLandmarks = null;
    }
    return true;
  }

  // Video-based gesture capture (owner brief, Task 4; fixed up per review, fix round 1): lets
  // js/video-landmarks.js's extractVideoLandmarks() reuse the page's ONE existing MediaPipe
  // Hands instance instead of creating a second one. Pauses the live hand loop (if it was
  // running), waits for any in-flight send() to finish, then switches onResults into
  // "detector mode" so each detect(canvas) call gets routed the next onResults callback
  // directly.
  async function createVideoDetector() {
    if (!state.hands) {
      throw new Error(
        'createVideoDetector() requires MediaPipe Hands to already be set up (call setupMediaPipe() first)'
      );
    }

    const wasLoopRunning = !state.loopPaused;
    pauseHandLoop();

    // Short polling wait for any live-loop send() already in flight, with a timeout so a
    // stuck send can't hang detector creation forever. Review item 4: if it's still stuck
    // after the timeout, restore the loop (we already paused it) and fail loudly instead of
    // silently proceeding - letting a live send's result resolve the first detect() would
    // shift every later frame by one.
    const pollStart = Date.now();
    while (state.sendInFlight && Date.now() - pollStart < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (state.sendInFlight) {
      if (wasLoopRunning) resumeHandLoop();
      throw new Error(
        'createVideoDetector(): timed out waiting for an in-flight camera frame send to finish'
      );
    }

    state.detectorMode = true;
    let releaseRequested = false;
    let released = false;

    // Runs the part of release() that isn't safe to do until the last outstanding
    // hands.send() this detector issued has been accounted for (review item 3): turning off
    // detector mode and resuming the live loop earlier could let a still-in-flight send's
    // late result take either path incorrectly. Called from release() itself (when nothing
    // is pending) and from onResults / the send-promise settling (when release() was
    // requested while a send was still in flight).
    function finishReleaseIfReady() {
      if (!releaseRequested || released || state.detectorSendPending) return;
      released = true;
      state.detectorMode = false;
      if (state.detectorFinishReleaseIfReady === finishReleaseIfReady) {
        state.detectorFinishReleaseIfReady = null;
      }
      // Drop the tracking state left over from the last video frame so the live loop starts
      // fresh on camera frames (whole-phase review).
      try {
        state.hands.reset();
      } catch (e) {
        console.warn('[gesture-data] hands.reset() after detector release failed:', e);
      }
      if (wasLoopRunning) resumeHandLoop();
    }

    function detect(canvas) {
      return new Promise((resolve, reject) => {
        if (releaseRequested) {
          reject(new Error('detect() called after release()'));
          return;
        }

        const timeoutId = setTimeout(() => {
          if (state.pendingDetectReject === wrappedReject) {
            state.pendingDetectResolve = null;
            state.pendingDetectReject = null;
          }
          reject(new Error('detect() timed out waiting for MediaPipe results'));
        }, 10000);

        const wrappedResolve = (results) => {
          clearTimeout(timeoutId);
          resolve(results);
        };
        const wrappedReject = (err) => {
          clearTimeout(timeoutId);
          reject(err);
        };

        state.pendingDetectResolve = wrappedResolve;
        state.pendingDetectReject = wrappedReject;
        state.detectorSendPending = true;

        // Settles detectorSendPending (and, if a release() is waiting on it, finishes that
        // release) for this specific send - whether it was already handled by onResults, or
        // needs handling here because no onResults ever came for it.
        function settleSendIfStillPending(err) {
          if (!state.detectorSendPending) return; // onResults already handled this one
          state.detectorSendPending = false;
          if (state.pendingDetectReject === wrappedReject) {
            state.pendingDetectResolve = null;
            state.pendingDetectReject = null;
            if (err) {
              wrappedReject(err);
            } else {
              // Review item "minor": the send settled but no onResults ever arrived for it -
              // reject promptly instead of making the caller wait out the full 10s timeout.
              wrappedReject(new Error('detect(): hands.send() settled without producing a result'));
            }
          }
          finishReleaseIfReady();
        }

        try {
          const maybePromise = state.hands.send({ image: canvas });
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(
              () => settleSendIfStillPending(null),
              (err) => settleSendIfStillPending(err)
            );
          } else {
            // send() didn't return a thenable - nothing more to observe; treat it as already
            // settled so a stuck release() isn't left waiting on it forever.
            state.detectorSendPending = false;
          }
        } catch (err) {
          state.detectorSendPending = false;
          state.pendingDetectResolve = null;
          state.pendingDetectReject = null;
          wrappedReject(err);
          finishReleaseIfReady();
        }
      });
    }

    function reset() {
      state.hands.reset();
    }

    function release() {
      if (releaseRequested) return;
      releaseRequested = true;

      // Reject any currently-pending detect() promise immediately - the caller shouldn't
      // have to wait out a 10s timeout just because release() happened (review item 3).
      if (state.pendingDetectReject) {
        const reject = state.pendingDetectReject;
        state.pendingDetectResolve = null;
        state.pendingDetectReject = null;
        reject(new Error('detect() rejected: release() was called before a result arrived'));
      }

      if (state.detectorSendPending) {
        // A send is still in flight; defer turning off detector mode / resuming the loop
        // until it settles (onResults or the send promise itself will call this).
        state.detectorFinishReleaseIfReady = finishReleaseIfReady;
      } else {
        finishReleaseIfReady();
      }
    }

    return { reset, detect, release };
  }

  // onHandResults(fn): subscribe to onResults callbacks outside detector mode. fn(results) is
  // called after latestLandmarks is updated for the frame. Returns an unsubscribe function.
  // Subscriber exceptions are caught and console.warn'ed (a bad subscriber must never break the
  // live hand loop).
  function onHandResults(fn) {
    state.handSubscribers.push(fn);
    return function unsubscribe() {
      const idx = state.handSubscribers.indexOf(fn);
      if (idx !== -1) state.handSubscribers.splice(idx, 1);
    };
  }

  // SAVE_META_KEYS: the v3 raw-sample metadata keys an optional `meta` object may carry into
  // the payload (video-based gesture capture, js/gesture-capture-ui.js). Any other key in
  // `meta` is ignored, so it can never override label/sign_language/frames.
  // textEn / textFil (strings) are sent as text_en / text_fil (sign-texts phase).
  const SAVE_META_KEYS = ["formatVersion", "source", "repIndex", "videoWidth", "videoHeight", "fps", "input"];

  async function saveGestureSample(label, frames, signLanguage = "ESL", videoBase64 = null, videoPath = null, category = null, meta = null) {
    const payload = {
      label:         cleanLabel(label),
      sign_language: (signLanguage === "FSL" || signLanguage === "BOTH") ? signLanguage : "ESL",
      frames,
    };
    if (meta && typeof meta === "object") {
      SAVE_META_KEYS.forEach((key) => {
        if (meta[key] !== undefined) payload[key] = meta[key];
      });
      if (typeof meta.textEn === "string") payload.text_en = meta.textEn;
      if (typeof meta.textFil === "string") payload.text_fil = meta.textFil;
    }
    if (videoBase64) {
      payload.video_base64 = videoBase64;
    }
    if (videoPath) {
      payload.video_path = videoPath;
    }
    if (category) {
      payload.category = category;
    }
    const res = await fetch(SAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("Raw response text:", text);
      throw new Error(`Invalid JSON response: ${text.slice(0, 100).trim()}`);
    }
    
    if (!res.ok || !json.success) {
      const err = new Error(json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.existingSet = json.existingSet;
      throw err;
    }
    return json;
  }

  // opts.summary: ask for the listing without frames (summary=1; save_gesture.php ignores it until
  // it supports it, and then returns frames as before).
  async function loadSavedGestureDataset(noSync = false, opts) {
    const params = [];
    if (noSync) params.push("no_sync=1");
    if (opts && opts.summary) params.push("summary=1");
    const url = params.length ? `${SAVE_ENDPOINT}?${params.join("&")}` : SAVE_ENDPOINT;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    state.savedCategories = json.categories || { ESL: {}, FSL: {} };
    state.signs = json.signs || {};
    return json.gestures || {};
  }

  function getSigns() {
    return state.signs;
  }

  // The text of sign `key` in a language: 'fil' -> Filipino text, anything else -> English text.
  // The database text (state.signs) wins; when it is unknown or empty, the text in a loaded model
  // file header (setModelSigns) is used. Returns a non-empty string, or null when neither has one.
  function getSignText(key, lang) {
    const pick = (sign) => {
      if (!sign) return null;
      const t = lang === "fil" ? sign.textFil : sign.textEn;
      return (typeof t === "string" && t !== "") ? t : null;
    };
    const fromDb = pick(state.signs && state.signs[key]);
    if (fromDb !== null) return fromDb;
    return Object.prototype.hasOwnProperty.call(state.modelSigns, key) ? pick(state.modelSigns[key]) : null;
  }

  // Remember the sign texts of a model file header (`header.labels`: [{ key, set, textEn, textFil,
  // ... }]). Calls for both languages merge; a later call for the same key replaces it.
  function setModelSigns(labels) {
    if (!Array.isArray(labels)) return;
    labels.forEach((l) => {
      if (!l || typeof l.key !== "string" || l.key === "") return;
      state.modelSigns[l.key] = { set: l.set, textEn: l.textEn, textFil: l.textFil };
    });
  }

  // GET php/api/signs.php and merge each sign's { set, textEn, textFil } into the state. Resolves
  // true/false; never throws.
  async function loadSigns() {
    try {
      const res = await fetch(SIGNS_ENDPOINT);
      const json = await res.json();
      if (!res.ok || !json.success || !json.signs) {
        throw new Error((json && json.error) || `HTTP ${res.status}`);
      }
      Object.keys(json.signs).forEach((key) => {
        const s = json.signs[key] || {};
        state.signs[key] = { set: s.set, textEn: s.textEn, textFil: s.textFil };
      });
      return true;
    } catch (e) {
      console.warn("[gesture-data] loadSigns failed:", e);
      return false;
    }
  }

  function getSavedCategories() {
    return state.savedCategories;
  }

  function recordingToFeatureRows(sample) {
    const frames = sample && Array.isArray(sample.frames) ? sample.frames : [];
    const isRaw = frames.some((frame) => Array.isArray(frame && frame.hands));

    if (isRaw) {
      const rows = frames
        .filter((frame) => Array.isArray(frame.hands) && frame.hands.length > 0)
        .map((frame) => flattenLandmarks(frame.hands.map((h) => h.landmarks)))
        .filter((row) => Array.isArray(row) && row.length === 126);

      const n = rows.length;
      if (n <= MAX_ROWS_PER_RAW_SAMPLE) return rows;

      const subsampled = [];
      for (let i = 0; i < MAX_ROWS_PER_RAW_SAMPLE; i++) {
        subsampled.push(rows[Math.round((i * (n - 1)) / (MAX_ROWS_PER_RAW_SAMPLE - 1))]);
      }
      return subsampled;
    }

    return frames
      .map((frame) => flattenLandmarks(frame.landmarks || frame))
      .filter((row) => Array.isArray(row) && row.length === 126);
  }

  // Pure transform: gestures (as returned by loadSavedGestureDataset) -> flat feature rows.
  // Split out so a caller that already has a fetched `gestures` object (the post-save reload
  // path in gesture-training-ui.js) can skip a second network round-trip.
  function recordingsToTrainingRows(gestures) {
    const rows = [];
    Object.keys(gestures).forEach((label) => {
      const sign = state.signs && state.signs[label];
      gestures[label].forEach((sample) => {
        const signLanguage = (sign && sign.set) || sample.signLanguage || 'ESL';
        recordingToFeatureRows(sample).forEach((features) => {
          rows.push({ label, features, signLanguage });
        });
      });
    });
    return rows;
  }

  async function loadGestureDatasetForTraining(noSync = false) {
    const gestures = await loadSavedGestureDataset(noSync);
    return recordingsToTrainingRows(gestures);
  }

  async function init() {
    const video = document.getElementById("videoFeed") || document.getElementById("video");
    if (video) {
      video.addEventListener("loadeddata", () => setupMediaPipe(video), { once: true });
      if (video.readyState >= 2) setupMediaPipe(video);
    }
  }

  window.GestureDataRecorder = {
    init,
    setupMediaPipe,
    preloadMediaPipe,
    pauseHandLoop,
    resumeHandLoop,
    setLoopOptions,
    getLoopStats,
    createVideoDetector,
    onHandResults,
    letterboxRect,
    getLatestLandmarks,
    getRawWristPosition,
    extractLandmarkFeatures,
    saveGestureSample,
    loadSavedGestureDataset,
    getSavedCategories,
    getSigns,
    getSignText,
    setModelSigns,
    loadSigns,
    loadGestureDatasetForTraining,
    recordingToFeatureRows,
    recordingsToTrainingRows,
    cleanLabel,
  };

  window.extractLandmarkFeatures = extractLandmarkFeatures;
  window.loadGestureDatasetForTraining = loadGestureDatasetForTraining;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
