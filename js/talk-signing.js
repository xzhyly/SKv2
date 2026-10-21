// js/talk-signing.js
// Live camera + sign recognition for talk.html's signing screen. Logic is ported from
// js/sign-to-text-ui.js's prediction loop (tlStartPredLoop, :416-601) and reuses that file's
// k-NN / label / sentence functions instead of copying them (they are loaded by TalkLoader).
// Contract: enter() acquires the camera; leave() releases the camera hardware (stops every
// track) but never touches the MediaPipe Hands instance, the k-NN model or the queue, so
// re-entry only pays for getUserMedia.
// Talk-turns-audio phase (docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md): the main
// button is "Send 🔊" (it replaces Translate / Stop & Add): recording starts by itself (the same 3 s
// countdown) once the camera runs, and Send (or the "stop" sign) hands the sentence and its sign keys
// to onText. Owner change 2026-10-19: leaving the turn discards what was not sent — leave() empties the
// sentence and the recognizer buffer, so Sign always starts empty; a language switch inside the turn
// keeps it. Recognition (tick's prediction, filter and debounce) is unchanged.
// pi-fixes 2026-10-21: enter() keeps an overlay ("Inihahanda ang camera… / Please stand by") over the camera
// and Send / Undo / Clear / Speak or Type disabled until the first video frame is on screen and MediaPipe
// has answered once; then the countdown starts and onLive() is called. ?devperf shows fps / detection time.
(function () {
  'use strict';

  // Constants copied from js/sign-to-text-ui.js (line numbers there):
  var ROLLING_WINDOW_SIZE = 4;    // :19
  var STABILITY_THRESHOLD = 2;    // :22
  var HOLD_MS = 500;              // :7 GESTURE_HOLD_MS
  var CONFIDENCE_FLOOR = 0.45;    // :501
  var NO_HAND_MS = 300;           // :432
  var TICK_MS = 150;              // :600
  var COUNTDOWN_S = 3;            // :723
  var SKELETON_KEY = 'sining_kamay_show_skeleton'; // :876
  // pi-fixes 2026-10-21: the camera overlay stays up until the first video frame is on screen AND
  // MediaPipe has returned its first result; only then do the buttons work and the countdown start.
  // READY_TIMEOUT_MS: if MediaPipe never answers, carry on anyway (logged) so the turn is never stuck.
  var READY_TIMEOUT_MS = 10000;
  var LOADING_TEXT = 'Inihahanda ang camera…\nPlease stand by';
  var PERF = new URLSearchParams(location.search).has('devperf');   // debug-only fps/detection overlay

  var cb = {};
  var active = false;
  var gen = 0;
  var stream = null;
  var tickId = null;
  var countdownId = null;
  var uiState = 'idle';           // 'idle' | 'countdown' | 'recording'
  var switching = false;
  var loading = false;            // camera/MediaPipe not ready yet (overlay up, buttons off)
  var readyTimer = null;
  var unsubReady = null;
  var perfTimer = null;
  var words = [];
  var keys = [];                  // the sign key of each word in `words` (for its audio)
  var history = [];
  var lastConfirmed = null;
  var stableTicks = 0;
  var lastDetected = null;
  var holdStart = null;
  var currentGesture = null;
  var lastHandAt = 0;

  function $(id) { return document.getElementById(id); }

  function setCaption(text) { $('signing-caption').textContent = text; }

  // The sentence bar under the camera (layout change 2026-10-18): one span per word, the newest one
  // highlighted, inside a two-line clip box (talk.html CSS); textContent stays exactly words.join(' ').
  function renderDraft(el, list) {
    el.textContent = '';
    var clip = document.createElement('div');
    clip.className = 'signing-draft-clip';
    var line = document.createElement('div');
    list.forEach(function (w, i) {
      if (i > 0) line.appendChild(document.createTextNode(' '));
      var span = document.createElement('span');
      span.className = i === list.length - 1 ? 'draft-word newest' : 'draft-word';
      span.textContent = w;
      line.appendChild(span);
    });
    clip.appendChild(line);
    el.appendChild(clip);
  }

  function showDraft() {
    var el = $('signing-draft');
    renderDraft(el, words);
    el.classList.toggle('show', words.length > 0);   // a sentence kept across a language switch shows during the countdown too
  }

  function setOverlay(show, text) {
    if (text) $('signing-cam-overlay-text').textContent = text;
    $('signing-cam-overlay').classList.toggle('show', !!show);
  }

  // Send is enabled once there is a word to send (also during the countdown after a language switch).
  function renderButton(countdown) {
    var b = $('stop-signing-btn');
    b.disabled = !stream || loading || switching || words.length === 0;
    if (uiState === 'countdown' && words.length === 0) b.textContent = 'Starting in ' + countdown + '…';
    else b.textContent = 'Send \u{1F50A}';
    $('signing-undo-btn').disabled = loading || words.length === 0;
    $('signing-clear-btn').disabled = loading || words.length === 0;
    $('sign-to-speak-btn').disabled = loading;
  }

  function syncChips() {
    var fil = signLang === 'fil';
    $('chip-esl').classList.toggle('active', !fil);
    $('chip-fsl').classList.toggle('active', fil);
    var on = window.showSkeleton !== false;
    var g = $('chip-guide');
    // Screen 03 controls redesign (docs/superpowers/specs/2026-09-21-
    // signing-screen-controls-redesign-design.md): label stays the static
    // short "Guide" — on/off now shows via .active (nav background) and
    // the CSS-only state dot (.guide-toggle::before, green when active),
    // not by rewriting the button's text on every sync.
    g.textContent = 'Guide';
    g.classList.toggle('active', on);
    g.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function clearHistory() {
    history = [];
    lastConfirmed = null;
    stableTicks = 0;
  }

  // clearWords: Send and leave() (leaving the turn discards it); a language switch keeps the sentence.
  function endSession(clearWords) {
    if (countdownId) { clearInterval(countdownId); countdownId = null; }
    uiState = 'idle';
    if (clearWords) { words = []; keys = []; }
    currentGesture = null;
    lastDetected = null;
    holdStart = null;
    clearHistory();
    $('camera-box').classList.remove('recording');
    showDraft();
    setCaption('Show your sign');
    renderButton();
  }

  function beginCountdown() {
    if (uiState !== 'idle' || !stream || loading) return;
    uiState = 'countdown';
    var n = COUNTDOWN_S;
    renderButton(n);
    countdownId = setInterval(function () {
      n--;
      if (n > 0) { renderButton(n); return; }
      clearInterval(countdownId);
      countdownId = null;
      uiState = 'recording';
      currentGesture = null;
      lastDetected = null;
      holdStart = null;
      clearHistory();
      $('camera-box').classList.add('recording');
      showDraft();
      renderButton();
    }, 1000);
  }

  // Send (the button, or the "stop" sign while recording). meta.words / meta.keys: the signs in order.
  function finish() {
    var got = words.slice();
    var gotKeys = keys.slice();
    if (!got.length) {
      if (uiState !== 'recording') return;
      endSession(true);
      if (cb.onEmpty) cb.onEmpty();
      return;
    }
    endSession(true);
    if (cb.onText) {
      cb.onText(formulateSmartSentence(got, signLang), {
        signLanguage: signLang === 'fil' ? 'FSL' : 'ESL', lang: signLang, words: got, keys: gotKeys
      });
    }
  }

  // Starts recording again (after "Didn't catch that"), if the camera is running.
  function restart() {
    if (active && stream && !switching && uiState === 'idle') beginCountdown();
  }

  // Drops the unsent sentence without leaving (+ New conversation also calls it; leave() already does).
  function clearDraft() {
    words = [];
    keys = [];
    showDraft();
    renderButton();
  }

  // ⌫ Undo / Clear (owner 2026-10-20): drop the last sign (word or phrase) or the whole sentence while
  // signing. The recognizer buffer is reset too, and the dropped sign stays the current gesture, so a
  // hand still holding it does not add it again at once (it can be added again after a different sign,
  // or once the hand is lowered: tick() clears currentGesture after NO_HAND_MS without a hand).
  function forgetRecognition(blockKey) {
    clearHistory();
    lastDetected = null;
    holdStart = null;
    if (blockKey) currentGesture = blockKey;
  }

  function undoLast() {
    if (!words.length) return;
    words.pop();
    var removed = keys.pop();
    forgetRecognition(removed);
    showDraft();
    renderButton();
  }

  function clearAll() {
    if (!words.length) return;
    var last = keys[keys.length - 1];
    words = [];
    keys = [];
    forgetRecognition(last);
    showDraft();
    renderButton();
  }

  function tick() {
    if (!stream || loading || !modelTrained || !knnModel || switching) return;
    // Nothing should start or stop behind an open confirm/error card.
    if (document.body.classList.contains('modal-open')) return;
    try {
      var now = Date.now();
      if (!window.GestureDataRecorder.getLatestLandmarks()) {
        if (now - lastHandAt > NO_HAND_MS) {
          setCaption('Show your sign');
          clearHistory();
          lastDetected = null;
          holdStart = null;
          currentGesture = null;
        }
        return;
      }
      lastHandAt = now;
      var f = extractFeatures($('signing-video'));
      if (!Array.isArray(f) || f.length !== activeFeatureSize) return;
      var pred = knnPredict(f);
      if (!pred) return;
      // Optional gloves (glove-hw Phase 2, js/glove-assist.js): re-ranks the top 5 only while 🧤 is ON
      // and every condition holds; otherwise the same scores come back.
      var scores = window.GloveAssist ? window.GloveAssist.apply(pred.scores, knnModel) : pred.scores;

      // 1. rolling temporal filter (newer predictions weigh more)
      history.push(scores);
      if (history.length > ROLLING_WINDOW_SIZE) history.shift();
      var weights = {};
      history.forEach(function (scores, idx) {
        var w = (idx + 1) / ROLLING_WINDOW_SIZE;
        for (var l in scores) weights[l] = (weights[l] || 0) + scores[l] * w;
      });
      var smoothed = 'unknown';
      var max = 0;
      for (var lbl in weights) {
        if (weights[lbl] > max) { max = weights[lbl]; smoothed = lbl; }
      }
      var totalW = history.reduce(function (s, _, i) { return s + (i + 1) / ROLLING_WINDOW_SIZE; }, 0);
      var avg = max / (totalW || 1);

      // 2. stability debounce
      var confirmed = 'unknown';
      if (smoothed !== 'unknown' && avg > CONFIDENCE_FLOOR) {
        if (smoothed === lastConfirmed) {
          stableTicks++;
          if (stableTicks >= STABILITY_THRESHOLD) confirmed = smoothed;
        } else {
          lastConfirmed = smoothed;
          stableTicks = 1;
        }
      } else {
        lastConfirmed = null;
        stableTicks = 0;
      }

      // 3. live caption
      if (confirmed !== 'unknown') setCaption(translateGestureLabel(confirmed, signLang));
      else setCaption(smoothed !== 'unknown' ? 'Stabilizing…' : 'Searching…');

      // 4. start / word / stop flow
      if (confirmed === 'unknown') { lastDetected = null; holdStart = null; return; }
      if (uiState === 'idle') {
        if (confirmed !== 'start') { lastDetected = null; holdStart = null; return; }
        if (confirmed !== lastDetected) { lastDetected = confirmed; holdStart = Date.now(); return; }
        if (Date.now() - holdStart < HOLD_MS) return;
        lastDetected = null;
        holdStart = null;
        clearHistory();
        beginCountdown();
      } else if (uiState === 'recording') {
        if (confirmed !== lastDetected) { lastDetected = confirmed; holdStart = Date.now(); return; }
        if (Date.now() - holdStart < HOLD_MS) return;
        if (confirmed === 'stop' && currentGesture !== 'stop') {
          currentGesture = 'stop';
          finish();
        } else if (confirmed !== 'start' && confirmed !== 'stop' && currentGesture !== confirmed) {
          currentGesture = confirmed;
          words.push(translateGestureLabel(confirmed, signLang));
          keys.push(confirmed);
          showDraft();
          renderButton();
          lastDetected = null;
          holdStart = null;
          clearHistory();
        } else {
          lastDetected = null;
          holdStart = null;
        }
      }
    } catch (e) {
      console.error('[talk-signing] prediction tick failed:', e);
    }
  }

  function loadModel() {
    modelTrained = false;
    knnModel = null;
    return autoTrainForTranslate().catch(function (e) {
      console.error('[talk-signing] model load failed:', e);
      return false;
    });
  }

  async function setLang(next) {
    if (!active || switching || next === signLang) return;
    var myGen = gen;
    var prev = signLang;
    switching = true;
    try {
      endSession(false);
      setOverlay(true, 'AI is switching language…');
      signLang = next;
      syncChips();
      var ok = await loadModel();
      // If the user left (or left and re-entered) while the model was loading, the switch is
      // abandoned quietly: no error card and no overlay change (leave()/enter() own the overlay).
      // A failed load is still reverted, so signLang and the loaded model never disagree; only
      // the card is skipped. Then just refresh the orange button, which enter() may have
      // rendered disabled while `switching` was true.
      if (!active || myGen !== gen) {
        if (!ok) { signLang = prev; syncChips(); await loadModel(); }
        switching = false;
        if (active) renderButton();
        return;
      }
      if (!ok) {
        signLang = prev;
        syncChips();
        await loadModel();
        if (!active || myGen !== gen) { switching = false; if (active) renderButton(); return; }
        if (cb.onModelError) cb.onModelError();
      }
    } finally {
      switching = false;   // every exit path, including a throw from loadModel/callbacks
    }
    setOverlay(false);
    // The kept sentence is shown in the new language (same signs).
    words = keys.map(function (k) { return translateGestureLabel(k, signLang); });
    showDraft();
    renderButton();
    restart();
  }

  function toggleSkeleton() {
    window.showSkeleton = window.showSkeleton === false;
    try { localStorage.setItem(SKELETON_KEY, window.showSkeleton); } catch (e) { /* storage blocked */ }
    if (!window.showSkeleton) {
      var c = $('tlCanvas1');
      var ctx = c.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    }
    syncChips();
  }

  // console.time markers for the camera start (pi-fixes 2026-10-21); a timer still open when the turn
  // is left is closed then, so the next entry can start it again.
  var openTimers = {};
  function timeStart(label) { if (!openTimers[label]) { openTimers[label] = true; console.time(label); } }
  function timeEnd(label) { if (openTimers[label]) { delete openTimers[label]; console.timeEnd(label); } }
  var T_FRAME = '[load] camera: first frame';
  var T_READY = '[load] camera + MediaPipe ready';

  function stopWaiting() {
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    if (unsubReady) { unsubReady(); unsubReady = null; }
  }

  // The camera is live: overlay down, buttons on, countdown. timedOut: MediaPipe never answered.
  function finishLoading(myGen, timedOut) {
    stopWaiting();
    if (!active || myGen !== gen || !loading) return;
    loading = false;
    if (timedOut) console.warn('[talk-signing] no MediaPipe result after ' + READY_TIMEOUT_MS + ' ms: starting anyway');
    timeEnd(T_FRAME);
    timeEnd(T_READY);
    setOverlay(false);
    renderButton();
    beginCountdown();                 // recording starts by itself (no Translate button any more)
    if (cb.onLive) cb.onLive();
  }

  // Waits for the first video frame on screen AND the first MediaPipe result (either order).
  function waitUntilReady(v, myGen) {
    var frame = false;
    var hands = false;
    function check() { if (frame && hands) finishLoading(myGen, false); }
    function onFrame() {
      if (frame || myGen !== gen) return;
      frame = true;
      timeEnd(T_FRAME);
      check();
    }
    if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(onFrame);
    else v.addEventListener('playing', onFrame, { once: true });
    var unsub = window.GestureDataRecorder.onHandResults(function () {
      if (hands || myGen !== gen) return;
      hands = true;
      // not inside the subscriber loop (unsubscribing there would skip the next subscriber)
      setTimeout(function () { if (unsubReady === unsub) { unsub(); unsubReady = null; } }, 0);
      check();
    });
    unsubReady = unsub;
    readyTimer = setTimeout(function () { finishLoading(myGen, true); }, READY_TIMEOUT_MS);
  }

  // Debug only (talk.html?devperf): camera fps, MediaPipe ms per frame and detections per second,
  // over the camera and in the console every 5 s (js/gesture-data.js getLoopStats).
  function startPerf() {
    if (!PERF || perfTimer) return;
    var el = $('dev-perf-overlay');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'dev-perf-overlay';
      el.style.cssText = 'position:absolute;left:6px;top:6px;z-index:6;margin:0;padding:4px 6px;' +
        'background:rgba(0,0,0,0.7);color:#fff;font:12px/1.35 Consolas,monospace;border-radius:4px;pointer-events:none';
      $('camera-box').appendChild(el);
    }
    window.GestureDataRecorder.getLoopStats();      // reset the window
    var n = 0;
    perfTimer = setInterval(function () {
      var st = window.GestureDataRecorder.getLoopStats();
      var text = 'video  ' + st.videoFps.toFixed(1) + ' fps\n' +
        'detect ' + st.detectMs.toFixed(0) + ' ms/frame\n' +
        'detect ' + st.detectFps.toFixed(1) + ' fps (1 of ' + st.detectEvery + ', model ' + st.modelComplexity + ')';
      el.textContent = text;
      if (++n % 5 === 0) console.log('[perf] ' + text.replace(/\n/g, ' | '));
    }, 1000);
  }
  function stopPerf() {
    if (perfTimer) { clearInterval(perfTimer); perfTimer = null; }
    var el = $('dev-perf-overlay');
    if (el) el.remove();
  }

  function enter() {
    if (active) return;             // idempotent: never a second stream while one is active/starting
    active = true;
    var myGen = ++gen;
    syncChips();
    loading = true;
    endSession(true);                 // a turn always starts with an empty sentence
    setOverlay(true, LOADING_TEXT);
    renderButton();
    timeStart(T_FRAME);
    timeStart(T_READY);
    initCameraWithFallback(320, 240, function (s) {
      try {
        if (!active || myGen !== gen) {   // left the screen while getUserMedia was in flight
          s.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        stream = s;
        var v = $('signing-video');
        v.srcObject = s;
        v.classList.add('active');
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* autoplay attr already set */ });
        waitUntilReady(v, myGen);
        window.GestureDataRecorder.resumeHandLoop();
        lastHandAt = Date.now();
        tickId = setInterval(tick, TICK_MS);
        startPerf();
      } catch (e) {
        // must not throw: camera-helper would treat it as a getUserMedia failure and re-request
        console.error('[talk-signing] camera start failed:', e);
      }
    }, function (err, msg) {
      if (!active || myGen !== gen) return;
      console.error('[talk-signing] camera failed:', err, msg);
      active = false;
      gen++;
      loading = false;
      stopWaiting();
      timeEnd(T_FRAME);
      timeEnd(T_READY);
      setOverlay(false);
      renderButton();
      if (cb.onCameraError) cb.onCameraError(msg, err);
    });
  }

  function leave() {
    if (!active) return;
    active = false;
    gen++;
    loading = false;
    stopWaiting();
    stopPerf();
    timeEnd(T_FRAME);
    timeEnd(T_READY);
    if (tickId) { clearInterval(tickId); tickId = null; }
    if (countdownId) { clearInterval(countdownId); countdownId = null; }
    if (window.GestureDataRecorder && window.GestureDataRecorder.pauseHandLoop) {
      window.GestureDataRecorder.pauseHandLoop();
    }
    // Release the camera hardware: stop every track, then detach it from the <video>.
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    var v = $('signing-video');
    v.srcObject = null;
    v.classList.remove('active');
    var c = $('tlCanvas1');
    var ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    setOverlay(false);
    endSession(true);                 // leaving the turn discards the unsent sentence and the recognizer buffer
  }

  function init(callbacks) {
    cb = callbacks || {};
    try { window.showSkeleton = localStorage.getItem(SKELETON_KEY) !== 'false'; } catch (e) { window.showSkeleton = true; }
    $('stop-signing-btn').addEventListener('click', function () {
      if (words.length) finish();
      else if (uiState === 'idle') beginCountdown();
    });
    $('signing-undo-btn').addEventListener('click', undoLast);
    $('signing-clear-btn').addEventListener('click', clearAll);
    $('chip-esl').addEventListener('click', function () { setLang('en'); });
    $('chip-fsl').addEventListener('click', function () { setLang('fil'); });
    $('chip-guide').addEventListener('click', toggleSkeleton);
  }

  function getDraft() { return { words: words.slice(), keys: keys.slice() }; }

  window.TalkSigning = { init: init, enter: enter, leave: leave, renderDraft: renderDraft, restart: restart, clearDraft: clearDraft, getDraft: getDraft,
    isLoading: function () { return active && loading; } };
})();
