# Signing Screen Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `sign-to-text.html`'s real camera UI into `talk.html`'s signing screen (replacing the fake "HELLO" placeholder), behind a background loading queue for the sign stack and the speech stack that gates a Guide/waiting screen; then archive `sign-to-text.html`.

**Architecture:** `talk.html` stays one document. A new `js/talk-loader.js` runs a sequential loading queue (sign stack first, then speech stack, order measured below) started once on page load. A new `js/talk-signing.js` owns camera + recognition for the signing screen and is driven by `onEnterSigning()`/`onLeaveSigning()`. It reuses the existing k-NN/sentence code in `js/sign-to-text-ui.js` (loaded by the queue) rather than copying it. Real output goes into the *existing* `openModal('confirm', …)` card.

**Tech Stack:** Vanilla JS/HTML/CSS, MediaPipe Hands (WASM), hand-rolled cosine k-NN, Vosk (library + model load only this phase). No build step, no framework, no CDN.

Spec: `docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md`. Standing conventions: `CLAUDE.md`, `docs/system/DECISIONS.md`, `docs/ui-target/README.md`.

## Step 1 investigation results (cited / measured)

**Load-time measurement** — in-app Chromium pane on this dev machine (NOT the Pi), `performance.now()` around each awaited load, every script/asset URL cache-busted with `?m=<random>`, fresh page load per run, 3 runs each:

| Stack | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|
| Sign, k-NN from localStorage cache (scripts + `hands.initialize()` + `autoTrainForTranslate()`) | 680 ms | 570 ms | 581 ms | **581 ms** |
| Sign, k-NN cache empty (rebuilt from DB via `php/api/save_gesture.php?no_sync=1`) | 1710 ms | 1539 ms | 1551 ms | **1551 ms** |
| Speech (`js/vosk.js` script + `Vosk.createModel(url)`) | 2543 ms | 2821 ms | 2737 ms | **2737 ms** |

Component medians for sign: scripts 276 ms (of which `tf.min.js` 227 ms), `hands.initialize()` 309 ms, k-NN from DB 979 ms / from cache 10 ms; speech: `vosk.js` 73 ms, `createModel` 2666 ms. **Sign is fastest in both cache states → queue order: sign stack first, speech stack second.** Pi timings will be slower; ordering is expected to hold but is not measured on the Pi (goes in MANUAL-CHECKS). Observation: nothing in `js/sign-to-text-ui.js`/`js/gesture-data.js` calls `tf.*` except a guarded `tf.io.removeModel` in `gesture-data.js:506-508` — `tf.min.js` looks unused by the live path; kept because the spec lists it. Reported, not acted on.

**Vosk stack (what `index.html`'s voice screen loads):** `index.html:751` `<script src="js/vosk.js" defer>` (5,657,075 bytes, defines global `Vosk`); the model URL and load are in `js/script.js:181-225` (`VoskSpeechRecognition.initModel`): `Vosk.createModel(origin + dir + '/models/vosk-model-small-en-us-0.15.tar.gz.zip')` (`js/script.js:201-203`), file is 41,138,088 bytes (`docs/system/HARDWARE_BOOT.md:7`). `initModel()` is only invoked when `?screen=voice` (`js/script.js:519`). The class itself is coupled to `index.html`'s DOM (`start-btn`, `.tts-mic-label`, `js/script.js:184-215`) so it is **not** reusable in `talk.html`; the queue does only the two loads (`js/vosk.js`, `Vosk.createModel`). Only an **English** model exists in the repo (`models/` holds one file); README's "one model chosen on screen 02" is unbuilt — out of scope.

**Sign stack file list** (`sign-to-text.html:9-14`): `tf.min.js`, `mediapipe/hands.js`, `db-api.js`, `gesture-data.js`, `camera-helper.js`, `speech-synthesis.js`, `db-local.js`. The spec names four; the queue additionally loads `js/sign-to-text-ui.js` (the recognition/sentence logic being reused). `db-api.js`, `speech-synthesis.js`, `db-local.js` are for history-saving / speaking aloud, which are out of scope this phase (talk.html has no DB or TTS yet).

**Existing error handling in `sign-to-text` (cited):**
- Camera: `js/camera-helper.js:8-15` (no `mediaDevices` → insecure-context message), `:20-22` (no webcam), `:46` (permission/open failure), `:50` (enumerate error); consumer `js/sign-to-text-ui.js:397-400` shows a 5 s toast only — no modal, and the "AI is getting ready" overlay stays up (`:328-333` only hides at `:348`).
- No hand: `js/sign-to-text-ui.js:431-447` — after 300 ms without landmarks the overlay reads "Show your sign" and the status dot goes red. **There is no "Hands not visible" state anywhere outside `archive/`** (grepped) — README:256 describes a state that was never built.
- Model load failure: `js/sign-to-text-ui.js:365-369` toast "AI loading failed. Manual translation active."; DB failure `:178-185` sets a tooltip only.
- Empty sentence: `js/sign-to-text-ui.js:644-646` "No words recorded in sentence."

**Existing confirm-card wiring in `talk.html`:** `openModal(kind, opts)` (`talk.html:1342-1356`) → `renderConfirmModal({label, text, from})` (`:1150-1186`); "Add to Conversation" calls `appendBubble({from, text, timestamp})` (`:1170`), `closeModal()`, `showScreen('thread')`; "Try again" calls `closeModal()` (`:1180-1184`). The fake signing Stop button calls `openModal('confirm', {label:'You signed', text: pickCanned(SIGNED_CANNED_POOL), from:'deaf'})` (`:1527-1533`). Real output feeds the same call; no second path. Error shell: `renderErrorModal({heading, message, buttonLabel, onAction})` (`:1291-1318`), already "the reusable shell a later phase calls into".

## Global Constraints

(verbatim from the loop prompt / spec; every task inherits these)

- One document. `talk.html` never navigates away mid-conversation except the two existing real page loads (End Conversation, idle "End Now") — both already `location.href` to `index.html`; neither changes.
- `onEnterSigning()`/`onEnterSpeaking()` must be idempotent — re-entering a screen already loaded this conversation must not re-init the camera, re-request getUserMedia, or create a second MediaPipe instance.
- The loading queue starts once, on `talk.html` load, regardless of which screen the user reaches first or how many times they switch screens before it finishes.
- The Guide/waiting gate blocks proceeding until the FULL queue (both stacks) is done — not just the stack relevant to the screen the user is on.
- Sign Language's 3-step guide content carries over as-is from `sign-to-text.html`. Speak or Type gets no equivalent guide — only a loading state if the queue isn't done yet. This asymmetry is intentional, not a gap to fill in.
- No separate Result screen. Camera output goes straight into `talk.html`'s existing confirm card pattern.
- No "Translate Text to Sign" cross-link carries over into the merged signing screen.
- Dev diagnostic overlay is off by default; whatever flag gates it must be something a reviewer can verify is off in a plain load (no URL param, no flag set).
- `onLeaveSigning()` pauses/stops the camera track and actually releases the hardware lock (browser's camera-in-use indicator must go off) without destroying the loaded model — re-entry must be instant, not a re-init.
- `reports.html` and `gesture-training.html`: untouched. `index.html` and `sign-to-text.html` are not modified by any code task (the `#translator-pane` link at `index.html:653` is an owner decision — do not touch it).
- Project rules: offline only, no build step, no framework, Raspberry Pi 4B target (1024×600, CPU only). Touch rules from `docs/ui-target/README.md`: nothing tappable under 60×60, no body text under 16px, no hover states (every tappable control has `:active`), one orange element per screen state, colours only from `css/tokens.css` (the `#16192a` camera backdrop is the README's own documented exception).

## Reconciliations (recorded in DECISIONS.md by Task 6)

1. **Idempotency vs. hardware-lock release.** The Global Constraints say re-entry must not re-request `getUserMedia`, and also that `onLeaveSigning()` must release the camera hardware. Both cannot hold literally: a released camera must be re-acquired. Resolution (the spec calls the release "more important than any other single detail"): `onEnterSigning()` is idempotent against *repeated/overlapping calls while active* (guard flag + generation token; one `getUserMedia` per real entry), the loaded model, MediaPipe instance and queue are never recreated, and only the camera track is re-acquired on re-entry. The Finally report must state this and give the measured `getUserMedia` count per entry.
2. **Start mechanism.** `sign-to-text.html` starts via the "start" gesture or a button, then a 3 s countdown, then records until the "stop" gesture or button. The merged screen has one orange button; it is the same toggle (label "Translate" idle → "Starting in N…" → "Stop & Add to Conversation" recording). The guide text is carried over unchanged (it says "TRANSLATE" and "STOP & TRANSLATE").
3. **Failure of a stack.** "Done" means settled (done or failed). A failed sign stack keeps the Guide's proceed button disabled with "Signing is not available right now." (Back still works). A failed speech stack does not block signing; on first Speak entry the existing error modal shows README's "Microphone not available" with a "Type instead" way out.
4. **Layout.** README's screen 03 has no room for the ESL/FSL and Hand Guide toggles under the camera (turn 2+: 90+96+16+300+14+68 = 584 of 600 px). They go in 200 px side columns beside the centred 560×300 camera.
5. **Dev flag:** URL param `?devqueue` (non-sticky; a plain load has no overlay element in the DOM at all).

## File Structure

- Modify `js/gesture-data.js` — additive only: `preloadMediaPipe`, `pauseHandLoop`, `resumeHandLoop`, hotkey opt-out flag, loop-generation guard. Existing call paths behave identically.
- Create `js/talk-loader.js` — the queue, its state API, the dev overlay.
- Create `js/talk-signing.js` — camera lifecycle, prediction loop, chips, button state machine.
- Modify `talk.html` — signing screen markup/CSS (guide + live), speaking wait state, gate wiring, remove fake signing path.
- Modify docs: `docs/system/UI.md`, `docs/system/DECISIONS.md`, `docs/system/MANUAL-CHECKS.md`, `CLAUDE.md`, `docs/system/DEBT.md`.
- Final commit only: `git mv sign-to-text.html archive/sign-to-text.html`.

---

### Task 1: Additive MediaPipe controls in `js/gesture-data.js`

**Files:**
- Modify: `js/gesture-data.js` (state block ~9-22; `runHandLoop` ~355-396; `installHotkey` ~615; exports ~685-701)

**Interfaces:**
- Produces on `window.GestureDataRecorder`: `preloadMediaPipe(video: HTMLVideoElement): Promise<boolean>` (creates the single `Hands` instance bound to `video`, calls `hands.initialize()`, leaves the frame loop paused), `pauseHandLoop(): void`, `resumeHandLoop(): void`. And `window.SK_DISABLE_GESTURE_HOTKEY` (if truthy, `installHotkey()` installs nothing).
- Existing behaviour of `setupMediaPipe`, `startRecording`, etc. must be unchanged for `gesture-training.html`.

- [ ] **Step 1: Add loop-control state.** In the `state` object add `loopPaused: false,` and `loopGen: 0,` (after `lastFrameAt`).

- [ ] **Step 2: Make `runHandLoop` pausable and single-instance.** Replace the whole `async function runHandLoop()` with:

```js
  async function runHandLoop() {
    if (!state.hands || !state.video) return;
    const gen = state.loopGen;
    if (state.loopPaused) {
      state.cameraLoop = null;
      return;
    }
    if (state.processingVideo) {
      state.cameraLoop = requestAnimationFrame(runHandLoop);
      return;
    }
    if (state.video.readyState >= 2) {
      try {
        /* ...the existing body from "Draw video frame to 2D Canvas..." through
           "await state.hands.send({ image: offscreenCanvas });" stays EXACTLY as it is... */
      } catch (err) {
        console.warn("[gesture-data] MediaPipe frame skipped:", err);
      }
    }
    // Paused or superseded (resumeHandLoop started a newer loop) while awaiting.
    if (gen !== state.loopGen || state.loopPaused) return;
    state.cameraLoop = requestAnimationFrame(runHandLoop);
  }
```
Keep the existing try-body verbatim (do not retype it — edit around it). `state.loopGen` never changes on the existing paths, so `gen !== state.loopGen` is always false for `gesture-training.html`.

- [ ] **Step 3: Add the three functions** directly after `runHandLoop`:

```js
  // Additive (signing-screen merge, docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md):
  // "Stop the loop, not the object." pauseHandLoop() stops sending frames but keeps the
  // Hands instance (and its ~15MB of WASM). resumeHandLoop() restarts frames on the same
  // instance. Both drop the last landmarks so a stale hand from before a pause is never
  // classified after resume.
  function pauseHandLoop() {
    state.loopPaused = true;
    state.loopGen++;
    if (state.cameraLoop) {
      cancelAnimationFrame(state.cameraLoop);
      state.cameraLoop = null;
    }
    state.latestLandmarks = null;
  }

  function resumeHandLoop() {
    if (!state.hands || !state.video) return;
    state.loopPaused = false;
    state.loopGen++;
    state.latestLandmarks = null;
    runHandLoop();
  }

  // Creates the ONE Hands instance early (talk.html's loading queue) and forces its WASM +
  // model to load now via initialize(), with the frame loop left paused until the camera
  // is actually on. Reuses setupMediaPipe, so it goes through the same non-SIMD patch and
  // is idempotent for the same video element (setupMediaPipe returns early).
  async function preloadMediaPipe(video) {
    const ok = await setupMediaPipe(video);
    if (!ok || !state.hands) return false;
    pauseHandLoop();
    await state.hands.initialize();
    return true;
  }
```

- [ ] **Step 4: Hotkey opt-out.** First line inside `installHotkey()`: `if (window.SK_DISABLE_GESTURE_HOTKEY) return;`

- [ ] **Step 5: Export.** Add `preloadMediaPipe, pauseHandLoop, resumeHandLoop,` to the `window.GestureDataRecorder = {…}` object.

- [ ] **Step 6: Verify.**
  - `node --check js/gesture-data.js` → no output.
  - `git diff --stat js/gesture-data.js` → only this file; `git diff js/gesture-data.js` shows only additions plus the `runHandLoop` gate lines (no other lines removed except the old final `state.cameraLoop = requestAnimationFrame(runHandLoop);` replaced by the guarded version).
  - Load `http://localhost/SKR/gesture-training.html` in the browser; console has no new errors; `typeof GestureDataRecorder.preloadMediaPipe === 'function'`.

- [ ] **Step 7: Commit.** `git add js/gesture-data.js && git commit -m "gesture-data: additive pause/resume/preload controls for the merged signing screen"`

---

### Task 2: Loading queue — `js/talk-loader.js`

**Files:**
- Create: `js/talk-loader.js`

**Interfaces:**
- Consumes (from Task 1): `GestureDataRecorder.preloadMediaPipe(video)`; DOM element `#signing-video` (added by Task 3 — until then the item fails with a clear message, which is fine for standalone testing: create a `<video id="signing-video">` in the console).
- Consumes globals from `js/sign-to-text-ui.js`: `autoTrainForTranslate(): Promise<boolean>`.
- Produces `window.TalkLoader`:
  - `start(): Promise<void>` — idempotent; the same promise on every call.
  - `isSettled(): boolean` — every item is `done` or `failed`.
  - `getItems(): Array<{id, stack:'sign'|'speech', name, status:'queued'|'loading'|'done'|'failed', ms:number|null, error:string|null}>` (copies).
  - `getProgress(): {total:number, finished:number, settled:boolean}` (`finished` counts done + failed).
  - `onChange(fn: () => void): void` — fn called after every status transition.
  - `voskModel: object|null` — the loaded Vosk model (held for the conversation; not used until the mic phase).
- Auto-starts once on window `load` (or immediately if already loaded).

- [ ] **Step 1: Create the file:**

```js
// js/talk-loader.js
// Background loading queue for talk.html (docs/superpowers/specs/2026-09-21-signing-screen-merge-design.md,
// "Loading queue"). Starts once, when the page has loaded, and runs the items one after
// another (queued, not parallel — the Pi 4B should not init both stacks at once). Order is
// measured, not assumed: sign stack first (median 581 ms warm / 1551 ms cold k-NN cache on
// the dev machine), speech stack second (median 2737 ms). See the plan's Step 1 table.
(function () {
  'use strict';

  var SIGN_SCRIPTS = [
    'js/lib/tf.min.js',
    'js/lib/mediapipe/hands.js',
    'js/camera-helper.js',
    'js/gesture-data.js',
    'js/sign-to-text-ui.js'
  ];
  // Same file index.html's voice screen loads (js/script.js:201-203), resolved against this page.
  var VOSK_MODEL_URL = new URL('models/vosk-model-small-en-us-0.15.tar.gz.zip', location.href).href;

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
        return window.GestureDataRecorder.preloadMediaPipe(video).then(function (ok) {
          if (!ok) throw new Error('MediaPipe Hands did not initialise');
        });
      } },
    { id: 'gestures', stack: 'sign', name: 'Gesture set (ESL)', needs: 'sign-libs',
      run: function () {
        return autoTrainForTranslate().then(function (ok) {
          if (!ok) throw new Error('gesture set unavailable (database unreachable and no cached model)');
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
  var startPromise = null;

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

  async function run() {
    for (var i = 0; i < ITEMS.length; i++) {
      var def = ITEMS[i];
      if (def.needs) {
        var dep = state.filter(function (s) { return s.id === def.needs; })[0];
        if (dep.status !== 'done') {
          setStatus(i, 'failed', 'skipped: "' + dep.name + '" failed');
          continue;
        }
      }
      setStatus(i, 'loading');
      var t0 = performance.now();
      try {
        await def.run();
        setStatus(i, 'done', null, Math.round(performance.now() - t0));
      } catch (e) {
        console.error('[TalkLoader] ' + def.name + ' failed:', e);
        setStatus(i, 'failed', String((e && e.message) || e), Math.round(performance.now() - t0));
      }
    }
  }

  function isSettled() {
    return state.every(function (s) { return s.status === 'done' || s.status === 'failed'; });
  }

  var api = {
    voskModel: null,
    start: function () {
      if (!startPromise) startPromise = run();
      return startPromise;
    },
    isSettled: isSettled,
    getItems: function () { return state.map(function (s) { return Object.assign({}, s); }); },
    getProgress: function () {
      var finished = state.filter(function (s) { return s.status === 'done' || s.status === 'failed'; }).length;
      return { total: state.length, finished: finished, settled: isSettled() };
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
  if (new URLSearchParams(location.search).has('devqueue')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildOverlay);
    else buildOverlay();
  }

  // ── Start once, when the page has loaded ──
  if (document.readyState === 'complete') setTimeout(api.start, 0);
  else window.addEventListener('load', api.start, { once: true });
})();
```

- [ ] **Step 2: Verify syntax.** `node --check js/talk-loader.js` → no output.

- [ ] **Step 3: Verify standalone in the browser** (talk.html does not include the script yet). Load `http://localhost/SKR/talk.html`, then in the console: create `<video id="signing-video">`, inject the script (`document.head.appendChild(Object.assign(document.createElement('script'),{src:'js/talk-loader.js'}))`), call `TalkLoader.start()` twice and confirm `TalkLoader.start() === TalkLoader.start()` (same promise), `await TalkLoader.start()`, then `TalkLoader.getItems()` → five items, all `done`, `TalkLoader.isSettled() === true`, `typeof TalkLoader.voskModel === 'object'`, and `performance.getEntriesByName(<vosk model url>).length === 1`.

- [ ] **Step 4: Verify the overlay is off by default and on with the param.** Plain load → `document.getElementById('dev-queue-overlay') === null`; load `talk.html?devqueue` → overlay exists and shows five lines.

- [ ] **Step 5: Commit.** `git add js/talk-loader.js && git commit -m "talk: background loading queue (sign stack then speech stack) with ?devqueue overlay"`

---

### Task 3: Signing screen markup/CSS, Guide + waiting gates, queue wiring in `talk.html`

**Files:**
- Modify: `talk.html` (CSS block for Screen 03/04; `#screen-signing` and `#screen-speaking` markup; the inline `<script>`: `onEnterSigning`/`onLeaveSigning`/`onEnterSpeaking`; new `<script src>` tags)

**Interfaces:**
- Consumes (Task 2): `TalkLoader.isSettled()`, `.getItems()`, `.getProgress()`, `.onChange(fn)`.
- Consumes (Task 4, guarded until it exists): `TalkSigning.enter()`, `TalkSigning.leave()`.
- Produces DOM ids Task 4 relies on: `#signing-video`, `#tlCanvas1` (**this exact id — `js/gesture-data.js`'s `onResults` draws the skeleton onto `document.getElementById('tlCanvas1')`**), `#camera-box`, `#signing-caption`, `#signing-draft`, `#signing-cam-overlay`, `#signing-cam-overlay-text`, `#stop-signing-btn`, `#chip-esl`, `#chip-fsl`, `#chip-guide`, `#guide-start-btn`; attribute `#screen-signing[data-signing="guide"|"live"]`; attribute `#screen-speaking[data-wait="1"|"0"]`.

- [ ] **Step 1: Script tags.** Immediately before the inline `<script>` (after `<script src="js/virtual-keyboard.js" defer></script>`) add, as plain (non-deferred, tiny, local) tags so the inline script can use them at parse time:

```html
  <script src="js/talk-loader.js"></script>
  <script src="js/talk-signing.js"></script>
```
Until Task 4 creates `js/talk-signing.js` this 404s; create an empty placeholder file `js/talk-signing.js` containing only `// placeholder — Task 4` so this task's verification has no console errors.

- [ ] **Step 2: Replace the `#screen-signing` markup** with (Guide text is carried over from `sign-to-text.html:29-59` unchanged, in Tagalog):

```html
  <div class="screen" id="screen-signing" data-signing="guide">
    <!-- Guide — first entry to Sign this conversation only (spec "Guide / waiting screens"). -->
    <div class="signing-guide" id="signing-guide">
      <div class="guide-badge">Guide</div>
      <h2 class="guide-title">Sign to Text Guide</h2>
      <p class="guide-desc">Maligayang pagdating sa real-time sign translator! Narito ang dalawang paraan upang magsalin:</p>
      <ul class="guide-list">
        <li class="guide-item">
          <span class="guide-num">1</span>
          <div class="guide-item-content">
            <strong class="guide-item-title">Simulan ang Pagsasalin (Start):</strong>
            <div class="guide-item-sub">&bull; <em>Awtomatiko:</em> Senyasan ang camera ng <strong>"start"</strong> para simulan ang 3s countdown.</div>
            <div class="guide-item-sub">&bull; <em>Manwal:</em> O i-click ang <strong>"TRANSLATE"</strong> button.</div>
          </div>
        </li>
        <li class="guide-item">
          <span class="guide-num">2</span>
          <div class="guide-item-content">
            <strong class="guide-item-title">I-senyas ang mga Salita (Sign Words):</strong>
            <div class="guide-item-sub">Gawin ang iyong mga custom gestures (hal. hello, thank you) nang may maikling sandali (pause) upang maipon ang mga salita.</div>
          </div>
        </li>
        <li class="guide-item">
          <span class="guide-num">3</span>
          <div class="guide-item-content">
            <strong class="guide-item-title">I-stop at Basahin (Stop):</strong>
            <div class="guide-item-sub">&bull; <em>Awtomatiko:</em> Senyasan ang <strong>"stop"</strong> para tapusin, pakinggan, at i-save ang pangungusap.</div>
            <div class="guide-item-sub">&bull; <em>Manwal:</em> O i-click ang <strong>"STOP &amp; TRANSLATE"</strong> button.</div>
          </div>
        </li>
      </ul>
      <div class="guide-loading" id="guide-loading" role="status"><span id="guide-loading-text">Getting ready…</span></div>
      <button type="button" class="guide-start-btn" id="guide-start-btn" disabled>Start Translating &rarr;</button>
    </div>

    <!-- Live camera view. -->
    <div class="signing-live" id="signing-live">
      <div class="signing-row">
        <div class="signing-side">
          <button type="button" class="mode-chip active" id="chip-esl">ESL Mode</button>
          <button type="button" class="mode-chip" id="chip-fsl">FSL Mode</button>
        </div>
        <div class="camera-box" id="camera-box">
          <video id="signing-video" class="camera-video" autoplay playsinline muted></video>
          <canvas id="tlCanvas1" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:2; transform:scaleX(-1);"></canvas>
          <div class="signing-draft" id="signing-draft"></div>
          <div class="signing-caption-pill"><span id="signing-caption">Show your sign</span></div>
          <div class="signing-cam-overlay" id="signing-cam-overlay"><span id="signing-cam-overlay-text">Starting camera…</span></div>
        </div>
        <div class="signing-side">
          <button type="button" class="mode-chip active" id="chip-guide" aria-pressed="true">Hand Guide: On</button>
        </div>
      </div>
      <button type="button" class="stop-signing-btn" id="stop-signing-btn">Translate</button>
    </div>
  </div>
```
Delete the old static `.hand-skeleton` SVG and the old "Stands in for the classifier…" comments; remove the `.hand-skeleton` CSS rule.

- [ ] **Step 3: Add the Speak wait state** inside `#screen-speaking`, as the first child, and add `data-wait="1"` to the section element:

```html
    <div class="speaking-wait" id="speaking-wait" role="status">
      <div class="speaking-wait-title">Getting ready…</div>
      <div class="speaking-wait-sub">This only takes a moment.</div>
    </div>
```

- [ ] **Step 4: CSS.** Add after the Screen 03 block (colours from tokens only; `rgba(...)` for translucent overlays like the rest of the file; the `rgba(22,25,42,…)` overlay is README's `#16192a` camera backdrop):

```css
  /* ── Screen 03 sub-states (signing-screen merge) ── */
  #screen-signing[data-signing="guide"] .signing-live{display:none}
  #screen-signing[data-signing="live"] .signing-guide{display:none}

  .signing-guide{
    width:660px;flex:1 1 auto;min-height:0;
    margin:12px 0 16px;padding:20px 32px;
    display:flex;flex-direction:column;align-items:center;gap:12px;
    background:var(--surface);border:1px solid var(--border);border-radius:16px;
    text-align:center;
  }
  .signing-guide > *{flex-shrink:0}
  .guide-badge{
    padding:4px 18px;border-radius:99px;
    background:var(--bg);color:var(--muted);
    font-size:16px;font-weight:700;letter-spacing:1px;
  }
  .guide-title{font-size:28px;font-weight:700;color:var(--navy);line-height:1.25}
  .guide-desc{font-size:16px;color:var(--muted);line-height:1.5}
  .guide-list{
    list-style:none;width:100%;text-align:left;
    display:flex;flex-direction:column;gap:14px;
    flex-shrink:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable;
  }
  /* Scroll cue: while more steps sit below the visible area the bottom edge fades out. */
  .guide-list.has-more{
    -webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent);
    mask-image:linear-gradient(to bottom,#000 calc(100% - 40px),transparent);
  }
  .guide-list::-webkit-scrollbar{width:6px}
  .guide-list::-webkit-scrollbar-track{background:var(--border)}
  .guide-list::-webkit-scrollbar-thumb{background:var(--muted-light);border-radius:99px}
  .guide-item{display:flex;align-items:flex-start;gap:14px;font-size:16px;color:var(--navy);line-height:1.5}
  .guide-num{
    width:32px;height:32px;border-radius:50%;flex:0 0 auto;
    display:flex;align-items:center;justify-content:center;
    background:var(--navy);color:var(--surface);font-size:16px;font-weight:700;
  }
  .guide-item-content{flex:1}
  .guide-item-title{font-weight:700}
  .guide-item-sub{font-size:16px;color:var(--muted);margin-top:4px;line-height:1.45}
  .guide-loading{font-size:16px;color:var(--muted);font-weight:600}
  .guide-start-btn{
    width:100%;height:60px;border:none;border-radius:12px;
    background:var(--orange);color:var(--surface);
    font-family:inherit;font-size:18px;font-weight:700;cursor:pointer;
    transition:background 0.08s;
  }
  .guide-start-btn:active{background:#ea6a0a}
  .guide-start-btn:disabled{opacity:0.5;cursor:not-allowed}

  .signing-live{display:flex;flex-direction:column;align-items:center}
  .signing-row{display:flex;align-items:flex-start;gap:16px}
  .signing-side{width:200px;display:flex;flex-direction:column;gap:12px;margin-top:16px}
  .mode-chip{
    width:200px;height:60px;
    border:1px solid var(--border);border-radius:12px;
    background:var(--surface);color:var(--muted);
    font-family:inherit;font-size:16px;font-weight:700;cursor:pointer;
    transition:transform 0.08s, border-color 0.08s;
  }
  .mode-chip.active{background:var(--navy);border-color:var(--navy);color:var(--surface)}
  .mode-chip:active{transform:scale(0.97)}
  .mode-chip:disabled{opacity:0.5;cursor:not-allowed}
  .camera-video{width:100%;height:100%;object-fit:contain;transform:scaleX(-1);display:none}
  .camera-video.active{display:block}
  /* Recording frame: an outline paints above the video (a box-shadow would hide under it).
     Green = live, per README's colour rules. */
  .camera-box.recording{outline:4px solid var(--green);outline-offset:-4px}
  .signing-caption-pill{z-index:3}
  .signing-draft{
    position:absolute;top:12px;left:50%;transform:translateX(-50%);
    max-width:520px;padding:6px 16px;border-radius:99px;
    background:rgba(0,0,0,0.7);color:var(--surface);
    font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    display:none;z-index:3;
  }
  .signing-draft.show{display:block}
  .signing-cam-overlay{
    position:absolute;inset:0;z-index:5;
    display:none;align-items:center;justify-content:center;
    background:rgba(22,25,42,0.92);
    color:var(--surface);font-size:18px;font-weight:700;
  }
  .signing-cam-overlay.show{display:flex}
  .stop-signing-btn:disabled{opacity:0.5;cursor:not-allowed}

  .speaking-wait{display:none;flex-direction:column;align-items:center;gap:8px;text-align:center}
  .speaking-wait-title{font-size:32px;font-weight:700;color:var(--navy)}
  .speaking-wait-sub{font-size:18px;color:var(--muted)}
  #screen-speaking[data-wait="1"] .speaking-wait{display:flex}
  #screen-speaking[data-wait="1"] .speaking-mic-row,
  #screen-speaking[data-wait="1"] .speaking-input-row{display:none}
```
Update the "Task 3 orange audit" comment: signing screen now has one orange element per sub-state (`#guide-start-btn` in guide, `#stop-signing-btn` in live; the other is `display:none`).

- [ ] **Step 5: Gate wiring.** Replace the empty `onEnterSigning`/`onLeaveSigning`/`onEnterSpeaking` hooks (keep `onLeaveSpeaking`/`onEndConversation` as they are) with:

```js
    // ── Signing-screen merge: loading gate ──
    // Guide shows on the FIRST entry to Sign this conversation (until "Start Translating" is
    // tapped once); after that Sign goes straight to the live camera. The proceed control is
    // blocked until the FULL queue (both stacks) has settled.
    var signingGuideSeen = false;
    var micWarned = false;

    function setSigningSubstate(name) {
      document.getElementById('screen-signing').setAttribute('data-signing', name);
    }
    function stackFailed(stack) {
      return TalkLoader.getItems().some(function (i) { return i.stack === stack && i.status === 'failed'; });
    }
    function maybeWarnMic(entering) {
      if (micWarned || !TalkLoader.isSettled() || !stackFailed('speech')) return;
      if (!entering && document.body.dataset.screen !== 'speaking') return;
      micWarned = true;
      openModal('error', {
        heading: 'Microphone not available',
        message: 'I cannot hear anything.',
        buttonLabel: 'Type instead'
      });
    }
    function refreshGates() {
      var p = TalkLoader.getProgress();
      var text = document.getElementById('guide-loading-text');
      var btn = document.getElementById('guide-start-btn');
      if (!p.settled) {
        text.textContent = 'Getting ready… ' + p.finished + ' of ' + p.total;
        btn.disabled = true;
      } else if (stackFailed('sign')) {
        text.textContent = 'Signing is not available right now.';
        btn.disabled = true;
      } else {
        text.textContent = 'Ready';
        btn.disabled = false;
      }
      document.getElementById('screen-speaking').setAttribute('data-wait', p.settled ? '0' : '1');
      maybeWarnMic(false);
    }
    TalkLoader.onChange(refreshGates);
    refreshGates();

    document.getElementById('guide-start-btn').addEventListener('click', function () {
      if (!TalkLoader.isSettled() || stackFailed('sign')) return;
      signingGuideSeen = true;
      setSigningSubstate('live');
      if (window.TalkSigning) TalkSigning.enter();
    });

    function onEnterSigning() {
      if (!signingGuideSeen) {
        setSigningSubstate('guide');
        refreshGates();
        return;
      }
      setSigningSubstate('live');
      if (window.TalkSigning) TalkSigning.enter();
    }
    function onLeaveSigning() {
      if (window.TalkSigning) TalkSigning.leave();
    }
    // Speak or Type gets no guide (spec: intentional asymmetry) — only the data-wait
    // "Getting ready…" state kept in sync by refreshGates() above.
    function onEnterSpeaking() {
      maybeWarnMic(true);
    }
```
Function declarations are hoisted, so their position relative to `showScreen` is fine; the `var`s and the listeners must appear after `openModal` is defined only at call time — put this whole block **after** the `closeModal()` definition and before the "Screen 02" card handlers.

- [ ] **Step 6: Guide scroll cue.** Add near the end of the inline script:

```js
    // Guide scroll cue (ported from sign-to-text.html): mark the step list while part of it
    // is below its visible area. Layout only.
    (function () {
      var list = document.querySelector('.guide-list');
      function update() {
        list.classList.toggle('has-more', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
      }
      list.addEventListener('scroll', update, { passive: true });
      var ro = new ResizeObserver(update);
      ro.observe(list);
      list.querySelectorAll('.guide-item').forEach(function (item) { ro.observe(item); });
      update();
    })();
```

- [ ] **Step 7: Verify (in-app browser, `resize_window` 1024×600, then `talk.html?devqueue` and plain `talk.html`).**
  - Plain load: no `#dev-queue-overlay`; zero console errors.
  - Immediately click Sign Language: Guide card visible, `#guide-start-btn.disabled === true` while `TalkLoader.isSettled() === false`, label reads "Getting ready… N of 5"; once settled label "Ready" and button enabled. Check both entry orders (Sign first / Speak first): Speak first shows `.speaking-wait` while unsettled and the mic/input rows appear once settled. If the queue is too fast to observe on localhost, slow it down for the test only by throttling the network in the pane or by wrapping `Vosk.createModel` in the console **before** load — record how you observed it.
  - `document.documentElement.scrollWidth === 1024` and `document.body.scrollWidth === 1024` in: who-first, signing/guide, signing/live, speaking/wait, speaking/ready.
  - Measure and report: guide card box, `#camera-box` (560×300), `#stop-signing-btn` (560×68), side chips (200×60), and turn-2+ signing layout (append a bubble first) — `#stop-signing-btn` bottom ≤ 600.
  - Orange audit: in each signing sub-state exactly one *visible* element has `background-color: rgb(249, 115, 22)`.
  - `git diff --stat` shows only `talk.html` and the placeholder `js/talk-signing.js`.

- [ ] **Step 8: Commit.** `git add talk.html js/talk-signing.js && git commit -m "talk: signing guide + waiting gates driven by the loading queue; live camera markup"`

---

### Task 4: Live camera + recognition — `js/talk-signing.js`, and remove the fake signing path

**Files:**
- Modify (replace placeholder): `js/talk-signing.js`
- Modify: `talk.html` (remove `SIGNED_CANNED_POOL` and the fake Stop handler; call `TalkSigning.init`; `onEndConversation`; drop the `window.TalkSigning &&` guards)

**Interfaces:**
- Consumes DOM ids from Task 3; consumes `GestureDataRecorder.pauseHandLoop/resumeHandLoop/getLatestLandmarks`; consumes globals from `js/sign-to-text-ui.js` / `js/camera-helper.js` (all only touched at call time, after the queue): `initCameraWithFallback(w,h,ok,err)`, `extractFeatures(video)`, `knnPredict(features)`, `translateGestureLabel(label, lang)`, `formulateSmartSentence(words, lang)`, `autoTrainForTranslate()`, and the globals `signLang` (assigned here), `modelTrained`, `knnModel`, `activeFeatureSize`.
- Produces `window.TalkSigning`: `init(callbacks)`, `enter()`, `leave()` where `callbacks = { onText(text), onEmpty(), onCameraError(message, err), onModelError() }`.
- Contract: `enter()` is idempotent while active; one `getUserMedia` per real entry (via `initCameraWithFallback`); `leave()` stops every track (`track.readyState === 'ended'`), sets `video.srcObject = null`, pauses the MediaPipe frame loop, clears the tick interval and any countdown, and **never** touches the `Hands` instance, the loaded model or the queue.

- [ ] **Step 1: Write `js/talk-signing.js`:**

```js
// js/talk-signing.js
// Live camera + sign recognition for talk.html's signing screen. Logic is ported from
// js/sign-to-text-ui.js's prediction loop (tlStartPredLoop, :416-601) and reuses that file's
// k-NN / label / sentence functions instead of copying them (they are loaded by TalkLoader).
// Contract: enter() acquires the camera; leave() releases the camera hardware (stops every
// track) but never touches the MediaPipe Hands instance, the k-NN model or the queue, so
// re-entry only pays for getUserMedia.
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

  var cb = {};
  var active = false;
  var gen = 0;
  var stream = null;
  var tickId = null;
  var countdownId = null;
  var uiState = 'idle';           // 'idle' | 'countdown' | 'recording'
  var switching = false;
  var words = [];
  var history = [];
  var lastConfirmed = null;
  var stableTicks = 0;
  var lastDetected = null;
  var holdStart = null;
  var currentGesture = null;
  var lastHandAt = 0;

  function $(id) { return document.getElementById(id); }

  function setCaption(text) { $('signing-caption').textContent = text; }

  function showDraft() {
    var el = $('signing-draft');
    el.textContent = words.join(' ');
    el.classList.toggle('show', uiState === 'recording' && words.length > 0);
  }

  function setOverlay(show, text) {
    if (text) $('signing-cam-overlay-text').textContent = text;
    $('signing-cam-overlay').classList.toggle('show', !!show);
  }

  function renderButton(countdown) {
    var b = $('stop-signing-btn');
    b.disabled = !stream || switching || uiState === 'countdown';
    if (uiState === 'countdown') b.textContent = 'Starting in ' + countdown + '…';
    else if (uiState === 'recording') b.textContent = 'Stop & Add to Conversation';
    else b.textContent = 'Translate';
  }

  function syncChips() {
    var fil = signLang === 'fil';
    $('chip-esl').classList.toggle('active', !fil);
    $('chip-fsl').classList.toggle('active', fil);
    var on = window.showSkeleton !== false;
    var g = $('chip-guide');
    g.textContent = 'Hand Guide: ' + (on ? 'On' : 'Off');
    g.classList.toggle('active', on);
    g.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function clearHistory() {
    history = [];
    lastConfirmed = null;
    stableTicks = 0;
  }

  function endSession() {
    if (countdownId) { clearInterval(countdownId); countdownId = null; }
    uiState = 'idle';
    words = [];
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
    if (uiState !== 'idle' || !stream) return;
    uiState = 'countdown';
    var n = COUNTDOWN_S;
    renderButton(n);
    countdownId = setInterval(function () {
      n--;
      if (n > 0) { renderButton(n); return; }
      clearInterval(countdownId);
      countdownId = null;
      uiState = 'recording';
      words = [];
      currentGesture = null;
      lastDetected = null;
      holdStart = null;
      clearHistory();
      $('camera-box').classList.add('recording');
      showDraft();
      renderButton();
    }, 1000);
  }

  function finish() {
    if (uiState !== 'recording') return;
    var got = words.slice();
    endSession();
    if (!got.length) {
      if (cb.onEmpty) cb.onEmpty();
      return;
    }
    if (cb.onText) cb.onText(formulateSmartSentence(got, signLang));
  }

  function tick() {
    if (!stream || !modelTrained || !knnModel || switching) return;
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

      // 1. rolling temporal filter (newer predictions weigh more)
      history.push(pred.scores);
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
          showDraft();
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
    var prev = signLang;
    switching = true;
    endSession();
    setOverlay(true, 'AI is switching language…');
    signLang = next;
    syncChips();
    var ok = await loadModel();
    if (!ok) {
      signLang = prev;
      syncChips();
      await loadModel();
      if (cb.onModelError) cb.onModelError();
    }
    switching = false;
    setOverlay(false);
    renderButton();
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

  function enter() {
    if (active) return;             // idempotent: never a second stream while one is active/starting
    active = true;
    var myGen = ++gen;
    syncChips();
    endSession();
    setOverlay(true, 'Starting camera…');
    renderButton();
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
        window.GestureDataRecorder.resumeHandLoop();
        lastHandAt = Date.now();
        tickId = setInterval(tick, TICK_MS);
        setOverlay(false);
        renderButton();
      } catch (e) {
        // must not throw: camera-helper would treat it as a getUserMedia failure and re-request
        console.error('[talk-signing] camera start failed:', e);
      }
    }, function (err, msg) {
      if (!active || myGen !== gen) return;
      console.error('[talk-signing] camera failed:', err, msg);
      active = false;
      gen++;
      setOverlay(false);
      if (cb.onCameraError) cb.onCameraError(msg, err);
    });
  }

  function leave() {
    if (!active) return;
    active = false;
    gen++;
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
    endSession();
  }

  function init(callbacks) {
    cb = callbacks || {};
    try { window.showSkeleton = localStorage.getItem(SKELETON_KEY) !== 'false'; } catch (e) { window.showSkeleton = true; }
    $('stop-signing-btn').addEventListener('click', function () {
      if (uiState === 'idle') beginCountdown();
      else if (uiState === 'recording') finish();
    });
    $('chip-esl').addEventListener('click', function () { setLang('en'); });
    $('chip-fsl').addEventListener('click', function () { setLang('fil'); });
    $('chip-guide').addEventListener('click', toggleSkeleton);
  }

  window.TalkSigning = { init: init, enter: enter, leave: leave };
})();
```

- [ ] **Step 2: Syntax check.** `node --check js/talk-signing.js` → no output.

- [ ] **Step 3: `talk.html` wiring.**
  - Delete `SIGNED_CANNED_POOL` and the whole "Screen 03 — Signing" fake Stop handler (`document.getElementById('stop-signing-btn').addEventListener(...)`). Keep `SPOKEN_CANNED_POOL` and `pickCanned`.
  - Remove the `window.TalkSigning &&` guards from Task 3 (`TalkSigning.enter()` / `.leave()` directly).
  - `onEndConversation()` body becomes `TalkSigning.leave();` (comment: release the camera before the real page load; the load itself also frees it).
  - Add, in the Screen 03 position:

```js
    // ── Screen 03 — Signing ──
    // Real camera + recognition (js/talk-signing.js). Output goes through the SAME confirm
    // card every other path uses — nothing reaches appendBubble() directly.
    TalkSigning.init({
      onText: function (text) {
        openModal('confirm', { label: 'You signed', text: text, from: 'deaf' });
      },
      onEmpty: function () {
        openModal('error', {
          heading: "Didn't catch that",
          message: 'I did not catch that.',
          buttonLabel: 'Try again'
        });
      },
      onCameraError: function () {
        openModal('error', {
          heading: 'Camera not available',
          message: 'I cannot reach the camera.',
          buttonLabel: 'Go back',
          onAction: function () {
            closeModal();
            var hasMessages = document.querySelector('#thread-list .bubble-row') !== null;
            showScreen(hasMessages ? 'thread' : 'who-first');
          }
        });
      },
      onModelError: function () {
        openModal('error', {
          heading: 'Sign set not available',
          message: 'I could not load that sign language.',
          buttonLabel: 'OK'
        });
      }
    });
```
  - Update comments in `talk.html` that call the signing screen fake/canned (the `#stop-signing-btn` orange-audit comment, the "two fake buttons" references that concern signing) so they are true now. Do not edit `docs/`.

- [ ] **Step 4: Verify with a fake camera** (see Task 5 for the harness: Chrome launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`). At minimum: Sign → Guide → Start → `#signing-video.srcObject` is a live `MediaStream`, overlay gone, button reads "Translate" and is enabled; leave via Back → every track `readyState === 'ended'`, `video.srcObject === null`; re-enter → new stream, works again. No console errors in either.

- [ ] **Step 5: Commit.** `git add talk.html js/talk-signing.js && git commit -m "talk: real camera + sign recognition on the signing screen; fake signing path removed"`

---

### Task 5: End-to-end verification and evidence (controller-run; measured, cited)

**Files:** none modified (temporary harness lives in the scratchpad, never in the repo).

- [ ] **Step 1: Harness.** Launch Chrome with `--remote-debugging-port=9333 --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --user-data-dir=<scratchpad>/profile --window-size=1024,700 http://localhost/SKR/talk.html` and drive it over CDP from a scratch Node script (Node's built-in `WebSocket`; nothing is installed into the repo). Emulate a 1024×600 viewport with `Emulation.setDeviceMetricsOverride`.
- [ ] **Step 2: Queue order + real load times** — read `TalkLoader.getItems()` `ms` values after settle, on a cold and a warm k-NN cache; assert the order of `loading` transitions is sign-libs → mediapipe → gestures → vosk-lib → vosk-model (record with `onChange`).
- [ ] **Step 3: Gate, both entry orders** — throttle so the queue is unsettled (CDP `Network.emulateNetworkConditions` or a delayed `Vosk.createModel`), and assert `#guide-start-btn.disabled` while unsettled and enabled after; and `#screen-speaking[data-wait]` transitions `1 → 0`. Sign first and Speak first.
- [ ] **Step 4: Idempotency (instrumentation lives only in the harness page, injected via CDP, never committed)** — count `getUserMedia` calls, `window.Hands` constructions, and `performance.getEntriesByType('resource')` hits per queue file. Enter Sign, leave, re-enter, switch to Speak and back: loader files fetched once; `Hands` constructed exactly once; `getUserMedia` called once per real entry (see Reconciliation 1); double-calling `TalkSigning.enter()` while active adds none.
- [ ] **Step 5: Camera hardware release evidence** — while on the signing screen record `stream.getTracks().map(t => t.readyState)` = `live`; after `showScreen('thread')` every track `ended`, `video.srcObject === null`, `stream.active === false`; also read Chrome's own view of capture state via CDP (`Target.getTargets` / `chrome://media-internals` dump if reachable) and, if a physical webcam is present, the Windows `CapabilityAccessManager\ConsentStore\webcam\NonPackaged\<chrome>` `LastUsedTimeStop` value (non-zero ⇒ released). State honestly which of these were obtained; the physical LED/indicator check goes to MANUAL-CHECKS.
- [ ] **Step 6: Recognition end-to-end with synthetic landmarks** — with the fake camera live, override `GestureDataRecorder.getLatestLandmarks` / `window.extractLandmarkFeatures` to return frames taken from the loaded `knnModel` (`start`, a word, `stop`), and assert: start gesture → countdown → recording, word added to `#signing-draft`, stop gesture → confirm card with `formulateSmartSentence` text, "Add to Conversation" → thread bubble; also the manual button path; empty sentence → "Didn't catch that" card; a failed camera (deny via CDP `Browser.setPermission` or `getUserMedia` override rejecting) → "Camera not available" card.
- [ ] **Step 7: Layout/console sweep** — for every new state (who-first, guide, live, live turn 2+, speaking/wait, speaking/ready, confirm, each error card) record `document.documentElement.scrollWidth` (must be 1024), console errors (must be 0), and the measured boxes. Screenshots saved to `docs/ui-target/actual/` only if that directory's convention calls for it (check first); otherwise scratchpad.
- [ ] **Step 8: `git diff --stat` audit** against the merge base of this phase: exactly `js/gesture-data.js`, `js/talk-loader.js`, `js/talk-signing.js`, `talk.html`, the docs listed below (and later the archive move) — no `index.html`, no `sign-to-text.html`, no `reports.html`, no `gesture-training.html`.

---

### Task 6: Documentation (separate commit from code)

**Files:** Modify `docs/system/UI.md`, `docs/system/DECISIONS.md`, `docs/system/MANUAL-CHECKS.md`, `docs/system/DEBT.md`, `CLAUDE.md`.

- [ ] `docs/system/UI.md`: Part 3 (`talk.html`) — the signing screen's two sub-states, the loading queue and its states, the waiting state on Speak, the dev overlay flag, the confirm/error wiring; every number cited by file/line or marked measured. Part 1 — note `sign-to-text.html` is archived (in the archive task's commit).
- [ ] `docs/system/DECISIONS.md`: append every decision settled during the run (the five Reconciliations, ordering by measurement, `?devqueue`, additive `gesture-data.js` exports and why, reuse of `sign-to-text-ui.js`, side-column layout, orange per sub-state, `tf.min.js` observation, README loading-rules vs spec conflict — the spec (later, owner-approved) supersedes README's "lazy on choose" rule with "queue on load").
- [ ] `docs/system/MANUAL-CHECKS.md`: new section for this phase (real camera on the Pi, gesture recognition, queue feel, camera indicator goes off, re-entry speed, Guide scroll cue, gate on slow load, mic-failure card); un-defer the `[DEFERRED — signing screen is being rebuilt]` item's wording accordingly.
- [ ] `docs/system/DEBT.md`: new items — `js/sign-to-text-ui.js` + `css/sign-to-text.css` still shared/orphaned after archive; `tf.min.js` looks unused; header LISTENING pill still undriven; idle timer ignores camera activity; README "Hands not visible" state unbuilt; Guide button names ("TRANSLATE", "STOP & TRANSLATE") do not match on-screen labels; Vosk English-only; `#translator-pane` link (owner decision).
- [ ] `CLAUDE.md`: update the `talk.html` paragraph (signing is now real camera + recognition; speech capture still fake) and the sign-to-text mentions.
- [ ] Commit: `git add docs CLAUDE.md && git commit -m "docs: signing-screen merge — UI, decisions, manual checks, debt"`

---

### Task 7: Archive `sign-to-text.html` (its own final commit)

Only after Tasks 1–6 are done and Task 5's evidence shows the merged version working end to end.

- [ ] `git mv sign-to-text.html archive/sign-to-text.html` (same treatment as `archive/camera-translator.html`, `docs/system/DEBT.md` item 30). Do NOT edit `index.html:653` (owner decision — logged in the report). Do NOT move `js/sign-to-text-ui.js` (still used by `talk.html`) or `css/sign-to-text.css` (orphaned; logged in DEBT).
- [ ] Update `docs/system/UI.md`/`INVENTORY.md` references to say archived.
- [ ] Verify `talk.html` still loads with zero console errors after the move; verify `http://localhost/SKR/sign-to-text.html` now 404s and that `index.html` still loads (the dead link is the known, reported item).
- [ ] Commit: `git commit -m "archive: retire sign-to-text.html (merged into talk.html)"`

## Self-Review

1. **Spec coverage:** port camera UI (Task 3/4) ✔; ESL/FSL, Hand Guide, live prediction, Stop & Translate (Task 4) ✔; loading queue, ordered by measurement (Task 2 + table) ✔; Guide/waiting asymmetry and full-queue gate (Task 3) ✔; dev overlay, off by default (Task 2) ✔; confirm flow reuse, no Result screen, no cross-link (Task 3/4) ✔; retirement (Task 7) ✔; error handling reusing what exists (investigation + Task 4 callbacks) ✔; `onLeaveSigning` release (Task 4 + Task 5 step 5) ✔; `#translator-pane` untouched (Global Constraints, Task 7) ✔; Step 0 seeds ✔; docs incl. CLAUDE.md ✔.
2. **Placeholder scan:** none — all code shown; Task 1 step 2 deliberately says keep the existing try-body verbatim rather than re-typing it.
3. **Type consistency:** `TalkLoader` API names and `TalkSigning` API names are identical across Tasks 2–4; DOM ids listed in Task 3's Interfaces match the markup and Task 4's `$()` calls.
