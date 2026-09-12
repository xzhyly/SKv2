(function () {
  const FRAME_TARGET = 30;
  const FRAME_MIN = 1;
  const FRAME_MAX = 40;
  const SAVE_ENDPOINT = (location.protocol === "file:")
    ? "http://localhost/Sining_kamay/php/api/save_gesture.php"
    : "php/api/save_gesture.php";

  const state = {
    hands: null,
    cameraLoop: null,
    latestLandmarks: null,
    recording: false,
    processingVideo: false,
    label: "",
    frames: [],
    lastFrameAt: 0,
    frameIntervalMs: 90,
    video: null,
    toast: null,
    ui: {},
  };

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

  function getRecorderPanels() {
    const panels = Array.from(document.querySelectorAll("[data-gesture-recorder]"));
    if (panels.length) {
      return panels.map((panel) => ({
        labelInput: panel.querySelector("[data-gesture-label]"),
        languageInput: panel.querySelector("[data-gesture-language]:checked"),
        startBtn: panel.querySelector("[data-gesture-start]"),
        stopBtn: panel.querySelector("[data-gesture-stop]"),
        status: panel.querySelector(".dataset-status"),
        statusText: panel.querySelector("[data-gesture-status-text]"),
        frameCount: panel.querySelector("[data-gesture-frame-count]"),
      }));
    }

    return [{
      labelInput: document.getElementById("gestureLabelInput"),
      languageInput: document.querySelector("[data-gesture-language]:checked"),
      startBtn: document.getElementById("startGestureDataBtn"),
      stopBtn: document.getElementById("stopGestureDataBtn"),
      status: document.getElementById("gestureDataStatus"),
      statusText: document.getElementById("gestureDataStatusText"),
      frameCount: document.getElementById("gestureDataFrameCount"),
    }];
  }

  function setRecorderUi(partial = {}) {
    state.ui.panels = getRecorderPanels();
    state.ui.panels.forEach(({ labelInput, startBtn, stopBtn, status, statusText, frameCount }) => {
      if (statusText && partial.message) statusText.textContent = partial.message;
      if (frameCount) frameCount.textContent = `${state.frames.length}`;
      if (status) {
        status.classList.toggle("idle", !state.recording);
        const fill = status.querySelector(".tr-lm-fill");
        if (fill) {
          const percent = Math.min((state.frames.length / FRAME_TARGET) * 100, 100);
          fill.style.width = `${percent}%`;
        }
      }
      if (startBtn) startBtn.disabled = state.recording;
      if (stopBtn) stopBtn.disabled = !state.recording;
      if (labelInput) {
        labelInput.disabled = state.recording;
        if (partial.label) labelInput.value = partial.label;
      }
    });
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
    if (state.cameraLoop) {
      cancelAnimationFrame(state.cameraLoop);
      state.cameraLoop = null;
    }
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
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });
    state.hands.onResults((results) => {
      const hands = results.multiHandLandmarks || [];
      state.latestLandmarks = hands.length > 0 ? hands : null;
      captureFrameIfRecording();
      
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
    const isTranslateOnly = new URLSearchParams(location.search).get('screen') === 'translate';
    if (!isTranslateOnly) {
      notify('Press "G" to record a labeled gesture sample.');
    }
    return true;
  }

  // Shared offscreen canvas to workaround Raspberry Pi Chromium video GPU SharedImage mailbox bugs
  // Forced to 320x240 to prevent WebAssembly OOM (memory access out of bounds) crashes
  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = 320;
  offscreenCanvas.height = 240;
  const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

  async function runHandLoop() {
    if (!state.hands || !state.video) return;
    if (state.processingVideo) {
      state.cameraLoop = requestAnimationFrame(runHandLoop);
      return;
    }
    if (state.video.readyState >= 2) {
      try {
        // Draw video frame to 2D Canvas context preserving aspect ratio (fit within 320x240)
        const vWidth = state.video.videoWidth || 320;
        const vHeight = state.video.videoHeight || 240;
        const targetWidth = 320;
        const targetHeight = 240;
        
        const videoRatio = vWidth / vHeight;
        const targetRatio = targetWidth / targetHeight;
        
        let dWidth = targetWidth;
        let dHeight = targetHeight;
        let dx = 0;
        let dy = 0;
        
        if (videoRatio > targetRatio) {
          dHeight = targetWidth / videoRatio;
          dy = (targetHeight - dHeight) / 2;
        } else {
          dWidth = targetHeight * videoRatio;
          dx = (targetWidth - dWidth) / 2;
        }
        
        offscreenCtx.fillStyle = '#000';
        offscreenCtx.fillRect(0, 0, targetWidth, targetHeight);
        offscreenCtx.drawImage(state.video, dx, dy, dWidth, dHeight);

        // Send canvas (rather than raw video) to bypass Chromium mailbox crashes
        await state.hands.send({ image: offscreenCanvas });
      } catch (err) {
        console.warn("[gesture-data] MediaPipe frame skipped:", err);
      }
    }
    state.cameraLoop = requestAnimationFrame(runHandLoop);
  }

  function captureFrameIfRecording() {
    if (!state.recording || state.frames.length >= FRAME_TARGET) return;
    const now = Date.now();
    if (now - state.lastFrameAt < state.frameIntervalMs) return;
    const landmarks = getLatestLandmarks();
    if (!landmarks) return;

    state.frames.push({
      index: state.frames.length,
      timestamp: now,
      landmarks: flattenLandmarks(state.latestLandmarks),
    });
    state.lastFrameAt = now;
    setRecorderUi({ message: `Recording "${state.label}"...` });

    if (state.frames.length >= FRAME_TARGET) {
      stopRecording();
    }
  }

  function startRecording(label) {
    const panels = getRecorderPanels();
    const input = panels.map((panel) => panel.labelInput).find((el) => el && el.value.trim());
    const selectedLanguage = (panels.map((panel) => panel.languageInput).find(Boolean)?.value || "ESL").toUpperCase();
    const clean = cleanLabel(label || (input && input.value) || prompt("Gesture label, for example hello or thank_you:"));
    if (!clean) {
      notify("Recording cancelled. A label is required.");
      setRecorderUi({ message: "Enter a label before capture" });
      return;
    }
    setRecorderUi({ label: clean });
    if (!state.hands) {
      setupMediaPipe();
    }
    state.recording = true;
    state.label = clean;
    state.signLanguage = selectedLanguage === "FSL" ? "FSL" : "ESL";
    state.frames = [];
    state.lastFrameAt = 0;
    setRecorderUi({ message: `Recording "${clean}"...`, label: clean });
    notify(`Recording "${clean}"... hold the gesture steady.`);
  }

  async function stopRecording() {
    if (!state.recording) return;
    state.recording = false;

    // Trigger capture-stopped callback so UI can stop recording video
    if (typeof window.onGestureCaptureStop === "function") {
      window.onGestureCaptureStop();
    }

    if (state.frames.length < FRAME_MIN) {
      notify(`Only ${state.frames.length} landmark frames captured. Try again.`);
      state.frames = [];
      setRecorderUi({ message: "Capture too short. Try again." });
      if (typeof window.onGestureCaptureCancelled === "function") {
        window.onGestureCaptureCancelled();
      }
      return;
    }

    if (state.frames.length > FRAME_MAX) {
      state.frames = state.frames.slice(0, FRAME_MAX);
    }

    // Trigger preview mode in UI instead of autosaving
    if (typeof window.onGestureCaptureReady === "function") {
      window.onGestureCaptureReady(state.label, state.signLanguage);
    } else {
      // Fallback: save immediately if no preview logic is attached
      await confirmAndSave();
    }
  }

  async function confirmAndSave() {
    if (state.frames.length === 0 || !state.label) {
      notify("No gesture data captured to save.");
      return { success: false };
    }

    // Grab the recorded video blob from the UI layer (set by gesture-training-ui.js)
    let videoBase64 = null;
    const videoPath = window.currentPreviewPath || null;
    if (!videoPath && window.currentPreviewBlob instanceof Blob) {
      try {
        videoBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result); // includes data-URI prefix
          reader.onerror = reject;
          reader.readAsDataURL(window.currentPreviewBlob);
        });
      } catch (e) {
        console.warn('[gesture-data] Could not convert video blob to base64:', e);
      }
    }

    try {
      const result = await saveGestureSample(state.label, state.frames, state.signLanguage, videoBase64, videoPath);
      if (result.success) {
        notify(`🎉 Saved ${state.frames.length} frames for "${state.label}".`);
        setRecorderUi({ message: `Saved "${state.label}"` });

        // Auto-invalidate Sign-to-Text model cache
        const lang = (state.signLanguage || 'ESL').toUpperCase();
        const modelKey = `indexeddb://sining-kamay-model-${lang}`;
        const labelsKey = `sining_kamay_labels_${lang}`;
        try {
          if (window.tf && typeof tf.io !== 'undefined' && typeof tf.io.removeModel === 'function') {
            await tf.io.removeModel(modelKey);
          }
        } catch (e) {
          // Model may not exist yet — safe to ignore
        }
        localStorage.removeItem(labelsKey);

        if (typeof window.reloadDataset === "function") {
          await window.reloadDataset();
        }
        if (typeof window.showToast === "function") {
          const videoMsg = result.videoAsset ? ` Video saved to ${result.videoAsset}.` : '';
          window.showToast(`🎉 Gesture "${state.label}" saved!${videoMsg} Sign-to-Text will retrain on next visit.`, 5000);
        }
        
        // Reset state
        state.frames = [];
        state.label  = "";
        window.currentPreviewBlob = null;
        window.currentPreviewPath = null;
        return { success: true, videoAsset: result.videoAsset };
      } else {
        notify("Gesture save failed.");
        setRecorderUi({ message: "Gesture save failed" });
        return { success: false };
      }
    } catch (err) {
      console.error("[gesture-data] Save failed:", err);
      notify(`Gesture save failed: ${err.message}`);
      setRecorderUi({ message: `Save failed: ${err.message}` });
      if (typeof window.showToast === "function") {
        window.showToast(`⚠️ Error: ${err.message}`, 6000);
      }
      return { success: false };
    }
  }

  function discardCapture() {
    state.frames = [];
    state.label = "";
    setRecorderUi({ message: "Capture discarded" });
    notify("Gesture capture discarded.");
  }

  async function saveGestureSample(label, frames, signLanguage = "ESL", videoBase64 = null, videoPath = null) {
    const payload = {
      label:         cleanLabel(label),
      sign_language: signLanguage === "FSL" ? "FSL" : "ESL",
      frames,
    };
    if (videoBase64) {
      payload.video_base64 = videoBase64;
    }
    if (videoPath) {
      payload.video_path = videoPath;
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
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  async function loadSavedGestureDataset(noSync = false) {
    const url = noSync ? `${SAVE_ENDPOINT}?no_sync=1` : SAVE_ENDPOINT;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json.gestures || {};
  }

  function recordingToFeatureRows(sample) {
    const frames = sample && Array.isArray(sample.frames) ? sample.frames : [];
    return frames
      .map((frame) => flattenLandmarks(frame.landmarks || frame))
      .filter((row) => Array.isArray(row) && row.length === 126);
  }

  async function loadGestureDatasetForTraining(noSync = false) {
    const gestures = await loadSavedGestureDataset(noSync);
    const rows = [];
    Object.keys(gestures).forEach((label) => {
      gestures[label].forEach((sample) => {
        const signLanguage = sample.signLanguage || 'ESL';
        recordingToFeatureRows(sample).forEach((features) => {
          rows.push({ label, features, signLanguage });
        });
      });
    });
    return rows;
  }

  function installHotkey() {
    const isTranslateOnly = new URLSearchParams(location.search).get('screen') === 'translate';
    if (isTranslateOnly) return;
    document.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "g") return;
      if (event.repeat) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (state.recording) {
        if (window.GestureDataRecorder && typeof window.GestureDataRecorder.stopRecording === 'function') {
          window.GestureDataRecorder.stopRecording();
        } else {
          stopRecording();
        }
      } else {
        if (window.GestureDataRecorder && typeof window.GestureDataRecorder.startRecording === 'function') {
          window.GestureDataRecorder.startRecording();
        } else {
          startRecording();
        }
      }
    });
  }

  function installUiControls() {
    setRecorderUi({ message: "Ready to capture landmark frames" });

    state.ui.panels.forEach(({ labelInput, startBtn, stopBtn }) => {
      if (startBtn) {
        startBtn.addEventListener("click", () => {
          if (window.GestureDataRecorder && typeof window.GestureDataRecorder.startRecording === 'function') {
            window.GestureDataRecorder.startRecording(labelInput ? labelInput.value : "");
          } else {
            startRecording(labelInput ? labelInput.value : "");
          }
        });
      }
      if (stopBtn) {
        stopBtn.addEventListener("click", () => {
          if (window.GestureDataRecorder && typeof window.GestureDataRecorder.stopRecording === 'function') {
            window.GestureDataRecorder.stopRecording();
          } else {
            stopRecording();
          }
        });
      }
      if (labelInput) {
        labelInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (window.GestureDataRecorder && typeof window.GestureDataRecorder.startRecording === 'function') {
              window.GestureDataRecorder.startRecording(labelInput.value);
            } else {
              startRecording(labelInput.value);
            }
          }
        });
      }
    });
  }

  async function init() {
    installHotkey();
    installUiControls();
    const video = document.getElementById("videoFeed") || document.getElementById("video");
    if (video) {
      video.addEventListener("loadeddata", () => setupMediaPipe(video), { once: true });
      if (video.readyState >= 2) setupMediaPipe(video);
    }
  }

  window.GestureDataRecorder = {
    init,
    startRecording,
    stopRecording,
    confirmAndSave,
    discardCapture,
    setupMediaPipe,
    getLatestLandmarks,
    extractLandmarkFeatures,
    saveGestureSample,
    loadSavedGestureDataset,
    loadGestureDatasetForTraining,
    recordingToFeatureRows,
  };

  window.extractLandmarkFeatures = extractLandmarkFeatures;
  window.loadGestureDatasetForTraining = loadGestureDatasetForTraining;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
