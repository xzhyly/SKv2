// js/talk-loader.js
// Background loading queue for talk.html (docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md,
// "Loading queue"). Items run one after another (queued, not parallel — the Pi 4B should not init
// both stacks at once). The k-NN model is the compiled file models/knn_<LANG>.bin (js/knn-model-store.js).
// pi-fixes 2026-10-21: the two stacks are separate queues. The SIGN stack (libraries -> MediaPipe ->
// k-NN model) starts when the page has loaded and is the only thing the Sign turn waits for (before,
// "Start Translating" waited for the whole queue, Vosk included, so the camera came after Vosk). The
// SPEECH stack (Vosk library -> model) starts only when talk.html calls startSpeech(): when Speak or
// Type opens, or in the background once the camera is live / a turn is over. Everything is loaded
// once per page load and reused by every turn. Each item is timed with console.time('[load] …').
(function () {
  'use strict';

  var SIGN_SCRIPTS = [
    'js/lib/tf.min.js',
    'js/lib/mediapipe/hands.js',
    'js/camera-helper.js',
    'js/gesture-data.js',
    'js/knn-compile.js',
    'js/knn-model-store.js',
    'js/sign-to-text-ui.js'
  ];
  // Same file index.html's voice screen loads (archive/script.js:201-203), resolved against this page.
  var VOSK_MODEL_URL = new URL('models/vosk-model-small-en-us-0.15.tar.gz.zip', location.href).href;

  // Live hand detection on this page (js/gesture-data.js setLoopOptions). DETECT_EVERY: send every Nth
  // camera frame to MediaPipe (?detectEvery=N overrides; 1 = every frame, the old behaviour).
  // MODEL_COMPLEXITY: 0 = the lite landmark model, 1 = full. MediaPipe loads the lite one from
  // js/lib/mediapipe/hand_landmark_lite.tflite, which is NOT vendored yet: copy it there (same
  // MediaPipe Hands package as the other files), then set LITE_MODEL_VENDORED to true. ?complexity=0
  // or =1 overrides for a test. (No existence check: a 404 would be a console error on every load.)
  var LITE_MODEL_VENDORED = false;
  var params = new URLSearchParams(location.search);
  var DETECT_EVERY = Math.max(1, parseInt(params.get('detectEvery'), 10) || 2);
  var MODEL_COMPLEXITY = params.has('complexity') ? (params.get('complexity') === '0' ? 0 : 1)
    : (LITE_MODEL_VENDORED ? 0 : 1);

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  var ITEMS = [
    { id: 'sign-libs', stack: 'sign', name: 'Sign libraries (TF.js, MediaPipe, helpers)', needs: null,
      run: function () {
        // Kiosk has no physical keyboard; gesture-data.js's "G" recording hotkey would open prompt().
        window.SK_DISABLE_GESTURE_HOTKEY = true;
        return SIGN_SCRIPTS.reduce(function (p, src) {
          return p.then(function () { return loadScript(src); });
        }, Promise.resolve());
      } },
    { id: 'mediapipe', stack: 'sign', name: 'MediaPipe Hands model', needs: 'sign-libs',
      run: function () {
        var video = document.getElementById('signing-video');
        if (!video) return Promise.reject(new Error('#signing-video not found'));
        var opts = window.GestureDataRecorder.setLoopOptions({ detectEvery: DETECT_EVERY, modelComplexity: MODEL_COMPLEXITY });
        console.log('[TalkLoader] hand detection: every ' + opts.detectEvery + ' camera frame(s), modelComplexity ' + opts.modelComplexity);
        return window.GestureDataRecorder.preloadMediaPipe(video, { warmUp: true }).then(function (ok) {
          if (!ok) throw new Error('MediaPipe Hands did not initialise');
        });
      } },
    { id: 'gestures', stack: 'sign', name: 'Gesture set (ESL)', needs: 'sign-libs',
      run: function () {
        // The sign texts (signs.php) load alongside the model; a failed loadSigns only means
        // captions fall back to the old label translation, so it never fails this item.
        var signs = window.GestureDataRecorder.loadSigns().then(function (ok) {
          if (!ok) console.warn('[TalkLoader] sign texts unavailable; captions fall back to labels');
        }, function (e) {
          console.warn('[TalkLoader] sign texts failed to load:', e);
        });
        return Promise.all([autoTrainForTranslate(), signs]).then(function (r) {
          if (!r[0]) throw new Error('gesture set unavailable (no usable model file and no stored copy)');
        });
      } },
    { id: 'vosk-lib', stack: 'speech', name: 'Vosk library', needs: null,
      run: function () { return loadScript('js/vosk.js'); } },
    { id: 'vosk-model', stack: 'speech', name: 'Vosk model (en-US)', needs: 'vosk-lib',
      run: function () {
        return window.Vosk.createModel(VOSK_MODEL_URL).then(function (model) {
          api.voskModel = model;
        });
      } }
  ];

  var state = ITEMS.map(function (def) {
    return { id: def.id, stack: def.stack, name: def.name, status: 'queued', ms: null, error: null };
  });
  var listeners = [];
  var stackPromises = {};   // stack -> the promise of its one run

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[TalkLoader] listener failed:', e); }
    });
  }

  function setStatus(i, status, error, ms) {
    state[i].status = status;
    state[i].error = error || null;
    if (typeof ms === 'number') state[i].ms = ms;
    emit();
  }

  async function run(stack) {
    // The speech stack waits for the sign stack (never both at once on the Pi).
    if (stack === 'speech' && stackPromises.sign) await stackPromises.sign;
    for (var i = 0; i < ITEMS.length; i++) {
      var def = ITEMS[i];
      if (def.stack !== stack) continue;
      if (def.needs) {
        var dep = state.filter(function (s) { return s.id === def.needs; })[0];
        if (dep.status !== 'done') {
          setStatus(i, 'failed', 'skipped: "' + dep.name + '" failed');
          continue;
        }
      }
      setStatus(i, 'loading');
      var label = '[load] ' + def.name;
      console.time(label);
      var t0 = performance.now();
      try {
        await def.run();
        setStatus(i, 'done', null, Math.round(performance.now() - t0));
      } catch (e) {
        console.error('[TalkLoader] ' + def.name + ' failed:', e);
        setStatus(i, 'failed', String((e && e.message) || e), Math.round(performance.now() - t0));
      }
      console.timeEnd(label);
    }
  }

  function itemsOf(stack) {
    return state.filter(function (s) { return !stack || s.stack === stack; });
  }
  function settledItem(s) { return s.status === 'done' || s.status === 'failed'; }
  // isSettled(stack): every item of that stack ('sign' / 'speech') has finished; no stack = all items.
  function isSettled(stack) { return itemsOf(stack).every(settledItem); }

  function startStack(stack) {
    if (!stackPromises[stack]) stackPromises[stack] = run(stack);
    return stackPromises[stack];
  }

  var api = {
    voskModel: null,
    // start(): the sign stack (page load). startSpeech(): the speech stack, once; later calls return
    // the same promise.
    start: function () { return startStack('sign'); },
    startSpeech: function () { return startStack('speech'); },
    speechStarted: function () { return !!stackPromises.speech; },
    isSettled: isSettled,
    getItems: function () { return state.map(function (s) { return Object.assign({}, s); }); },
    getProgress: function (stack) {
      var list = itemsOf(stack);
      var finished = list.filter(settledItem).length;
      return { total: list.length, finished: finished, settled: finished === list.length };
    },
    onChange: function (fn) { listeners.push(fn); }
  };
  window.TalkLoader = api;

  // ── Dev-only diagnostic overlay ──
  // Off by default. Gated by the URL param ?devqueue (not sticky, not stored): on a plain
  // load nothing below runs and no overlay element ever exists in the DOM. The user-facing
  // "Getting ready…" label on the Guide card is separate and always visible.
  function buildOverlay() {
    var el = document.createElement('pre');
    el.id = 'dev-queue-overlay';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:300;margin:0;padding:8px 10px;' +
      'background:rgba(0,0,0,0.82);color:#fff;font:12px/1.4 Consolas,monospace;border-radius:6px;' +
      'pointer-events:none;white-space:pre-wrap;max-width:560px';
    (document.getElementById('stage') || document.body).appendChild(el);
    var MARK = { queued: '·', loading: '…', done: '✓', failed: '✗' };
    function render() {
      el.textContent = state.map(function (s) {
        return MARK[s.status] + ' ' + s.name + ' — ' + s.status + (s.ms !== null ? ' (' + s.ms + ' ms)' : '') +
          (s.error ? '\n    ' + s.error : '');
      }).join('\n');
    }
    api.onChange(render);
    render();
  }
  if (params.has('devqueue')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildOverlay);
    else buildOverlay();
  }

  // ── Start the sign stack once, when the page has loaded ──
  if (document.readyState === 'complete') setTimeout(api.start, 0);
  else window.addEventListener('load', api.start, { once: true });
})();
