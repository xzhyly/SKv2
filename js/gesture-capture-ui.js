// Full-screen recording mode for gesture-training.html Step 1's "Record 3 samples"
// (video-based gesture capture, Task 5). One responsibility: this mode's state machine and
// its DOM (#gcMode in gesture-training.html).
//
// Flow: Ready -> Countdown (3, 2, 1) -> Recording (live guidance from the shared
// GestureCaptureCore segmenter fed by GestureDataRecorder.onHandResults) -> Review (the
// recording plays back) -> Processing (VideoLandmarks.extractVideoLandmarks on the ONE shared
// MediaPipe instance via GestureDataRecorder.createVideoDetector) -> Saving (3 sequential
// saveGestureSample calls, v3 raw metadata, never any video) -> Done.
//
// Discard rule: every exit (Done, Redo, Cancel, error states, pagehide) stops the recorder,
// unsubscribes from onHandResults, drops the Blob, revokes its object URL, clears the review
// video and releases a held detector. The video never leaves the browser.
//
// Public API: window.GestureCaptureUI = { open({ label, signSet, category, stream }), close() }.
// On success it calls window.onCaptureSamplesSaved({ label, signLanguage, labelSampleCount,
// frameCount }) (set by js/gesture-training-ui.js) once, then closes and shows a toast.
(function () {
  'use strict';

  var CATEGORY_NAMES = { word: 'Word', letter: 'Letter', number: 'Number', phrase: 'Phrase' };
  var MSG = {
    cameraStopped: 'The camera stopped. Please try again.',
    tooLong: 'That sign took longer than 20 seconds. Please redo.',
    noRest: 'No rest was found at the start. Please redo.',
  };
  var START_TIMEOUT_MS = 3000; // recorder 'start' must fire within this, else camera-stopped

  var el = null; // DOM refs, resolved once by bindDom()
  var mode = 'closed'; // closed | ready | countdown | recording | review | processing | saving | finishing | error
  var gen = 0; // bumped on every exit/reset; async continuations started earlier compare against it
  var session = null; // { label, signSet, category, stream } captured at open() time
  var countdownTimer = null;
  var rec = null; // the active recording (see startRecording)
  var blob = null;
  var blobUrl = null;
  var reviewCount = 0;
  var detector = null; // a held createVideoDetector() detector (released on every exit)
  var abortCtrl = null; // aborts extraction on Cancel
  var pending = null; // the extracted reps waiting to be saved (kept in memory for "Retry save")

  function core() { return window.GestureCaptureCore; }
  function C() { return window.GestureCaptureCore.CAPTURE; }
  function recorderApi() { return window.GestureDataRecorder; }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function bindDom() {
    if (el) return el;
    var byId = function (id) { return document.getElementById(id); };
    el = {
      root: byId('gcMode'),
      chip: byId('gcChip'),
      cancel: byId('gcCancel'),
      live: byId('gcLive'),
      review: byId('gcReview'),
      start: byId('gcStart'),
      countdown: byId('gcCountdown'),
      rec: byId('gcRec'),
      recTime: byId('gcRecTime'),
      prompt: byId('gcPrompt'),
      dots: byId('gcDots'),
      hand: byId('gcHand'),
      handText: byId('gcHandText'),
      hint: byId('gcHint'),
      msg: byId('gcMsg'),
      progress: byId('gcProgress'),
      progressFill: byId('gcProgressFill'),
      actions: byId('gcActions'),
      save: byId('gcSave'),
      retrySave: byId('gcRetrySave'),
      redo: byId('gcRedo'),
    };
    if (!el.root) { el = null; return null; }
    el.cancel.addEventListener('click', onCancel);
    el.start.addEventListener('click', startCountdown);
    el.save.addEventListener('click', saveRecording);
    el.redo.addEventListener('click', toReady);
    el.retrySave.addEventListener('click', function () {
      if (mode === 'error' && pending) runSaves();
    });
    return el;
  }

  // ── View ──
  // One place that decides what is visible. spec: { live, review, start, countdown, rec, prompt,
  // dots, hand, msg (string|null), msgError, progress (0..1|null), actions ([ids]), cancel }.
  function view(spec) {
    el.root.setAttribute('data-state', mode);
    el.live.hidden = !spec.live;
    el.review.hidden = !spec.review;
    el.start.hidden = !spec.start;
    el.countdown.hidden = !spec.countdown;
    el.rec.hidden = !spec.rec;
    el.prompt.hidden = !spec.prompt;
    el.dots.hidden = !spec.dots;
    el.hand.hidden = !spec.hand;
    setHint(null);
    setMsg(spec.msg || null, !!spec.msgError);
    setProgress(spec.progress === undefined ? null : spec.progress);
    var actions = spec.actions || [];
    el.actions.hidden = actions.length === 0;
    el.save.hidden = actions.indexOf('save') === -1;
    el.retrySave.hidden = actions.indexOf('retrySave') === -1;
    el.redo.hidden = actions.indexOf('redo') === -1;
    el.cancel.hidden = spec.cancel === false;
  }

  function setMsg(text, isError) {
    el.msg.hidden = !text;
    el.msg.textContent = text || '';
    el.msg.classList.toggle('error', !!isError);
  }

  function setHint(text) {
    el.hint.hidden = !text;
    if (el.hint.textContent !== (text || '')) el.hint.textContent = text || '';
  }

  function setProgress(fraction) {
    el.progress.hidden = fraction === null;
    if (fraction !== null) {
      el.progressFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    }
  }

  function setHand(present) {
    el.hand.classList.toggle('on', present);
    el.handText.textContent = present ? 'Hand visible' : 'No hand';
  }

  function setDots(repsDone, currentActive) {
    var dots = el.dots.children;
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('done', i < repsDone);
      dots[i].classList.toggle('current', currentActive && i === repsDone);
    }
  }

  function formatElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function streamIsLive(stream) {
    return !!(stream && typeof stream.getVideoTracks === 'function' &&
      stream.getVideoTracks().some(function (t) { return t.readyState === 'live'; }));
  }

  // ── Open / close ──
  function open(opts) {
    if (!bindDom()) { console.error('[gesture-capture-ui] #gcMode markup is missing.'); return; }
    if (mode !== 'closed') return;
    if (!core() || !window.VideoLandmarks || !recorderApi()) {
      console.error('[gesture-capture-ui] capture-core.js / video-landmarks.js / gesture-data.js not loaded.');
      return;
    }
    session = {
      label: opts.label,
      signSet: opts.signSet === 'FSL' ? 'FSL' : 'ESL',
      category: opts.category || 'word',
      stream: opts.stream,
    };
    el.chip.textContent = session.label + ' · ' + session.signSet + ' · ' +
      (CATEGORY_NAMES[session.category] || session.category);
    el.live.srcObject = session.stream;
    var p = el.live.play();
    if (p && typeof p.catch === 'function') p.catch(function (e) { console.warn('[gesture-capture-ui] live preview play failed:', e); });
    el.root.hidden = false;
    showReady();
  }

  // Leaves the mode from any state, applying the discard rule. The page's own camera stream is
  // NOT stopped (it belongs to the page); only this overlay's second <video> lets go of it.
  function close() {
    if (!el || mode === 'closed') return;
    gen++;
    resetWork();
    el.live.pause();
    el.live.srcObject = null;
    session = null;
    mode = 'closed';
    el.root.setAttribute('data-state', mode);
    el.root.hidden = true;
  }

  // Everything a Redo or an exit must throw away (the discard rule).
  function resetWork() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    discardRecording();
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    if (detector) {
      try { detector.release(); } catch (e) { console.warn('[gesture-capture-ui] detector release failed:', e); }
      detector = null;
    }
    dropBlob();
    pending = null;
    reviewCount = 0;
  }

  function dropBlob() {
    blob = null;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if (el && el.review.hasAttribute('src')) {
      el.review.pause();
      el.review.removeAttribute('src');
      el.review.load();
    }
  }

  // ── Ready / countdown ──
  function showReady() {
    mode = 'ready';
    view({ live: true, start: true });
  }

  function toReady() {
    if (mode !== 'review' && mode !== 'error') return;
    gen++;
    resetWork();
    showReady();
  }

  function startCountdown() {
    if (mode !== 'ready') return;
    mode = 'countdown';
    var n = 3;
    view({ live: true, countdown: true });
    el.countdown.textContent = String(n);
    countdownTimer = setInterval(function () {
      n--;
      if (n > 0) {
        el.countdown.textContent = String(n);
        return;
      }
      clearInterval(countdownTimer);
      countdownTimer = null;
      startRecording();
    }, 1000);
  }

  // ── Recording ──
  function startRecording() {
    if (mode !== 'countdown') return;
    var stream = session.stream;
    if (!streamIsLive(stream)) { showError(MSG.cameraStopped); return; }

    var recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    } catch (e) {
      try {
        recorder = new MediaRecorder(stream);
      } catch (e2) {
        console.warn('[gesture-capture-ui] MediaRecorder could not start:', e2);
        showError(MSG.cameraStopped);
        return;
      }
    }

    var r = {
      recorder: recorder,
      chunks: [],
      originMs: null,
      seg: core().createSegmenter(),
      unsub: null,
      tailTimer: null,
      clockTimer: null,
      startTimer: null,
      done: false,
      discarded: false,
      tracks: stream.getVideoTracks(),
      onTrackEnded: null,
    };
    rec = r;

    r.onTrackEnded = function () {
      if (rec === r && !r.discarded) failRecording(MSG.cameraStopped);
    };
    r.tracks.forEach(function (t) { t.addEventListener('ended', r.onTrackEnded); });

    recorder.ondataavailable = function (e) {
      if (!r.discarded && e.data && e.data.size > 0) r.chunks.push(e.data);
    };
    recorder.onerror = function (e) {
      console.warn('[gesture-capture-ui] MediaRecorder error:', e && e.error ? e.error : e);
      if (rec === r && !r.discarded) failRecording(MSG.cameraStopped);
    };
    recorder.onstart = function () {
      if (rec !== r || r.discarded) return;
      if (r.startTimer) { clearTimeout(r.startTimer); r.startTimer = null; }
      r.originMs = performance.now(); // the recording's time origin
      r.unsub = recorderApi().onHandResults(function (results) { onHand(r, results); });
      r.clockTimer = setInterval(function () {
        el.recTime.textContent = formatElapsed(performance.now() - r.originMs);
      }, 250);
    };
    recorder.onstop = function () {
      if (r.discarded) return;
      finishRecording(r);
    };

    mode = 'recording';
    view({ live: true, rec: true, prompt: true, dots: true, hand: true });
    el.recTime.textContent = '0:00';
    setHand(false);
    renderGuidance(r, 0, false);
    try {
      recorder.start();
      r.startTimer = setTimeout(function () {
        r.startTimer = null;
        if (rec === r && !r.discarded && r.originMs === null) failRecording(MSG.cameraStopped);
      }, START_TIMEOUT_MS);
    } catch (e) {
      console.warn('[gesture-capture-ui] MediaRecorder.start failed:', e);
      failRecording(MSG.cameraStopped);
    }
  }

  function onHand(r, results) {
    if (rec !== r || r.discarded || r.originMs === null) return;
    var t = performance.now() - r.originMs;
    var present = !!(results && results.multiHandLandmarks && results.multiHandLandmarks.length > 0);
    setHand(present);
    if (r.done) return; // the STOP_TAIL_MS tail: keep recording, stop segmenting

    var res = r.seg.push(t, present);
    if (res.event === 'rep-too-long') {
      failRecording(MSG.tooLong);
      return;
    }
    renderGuidance(r, t, present);
    if (res.event === 'done') {
      r.done = true;
      r.tailTimer = setTimeout(function () { stopForReview(r); }, C().STOP_TAIL_MS);
    }
  }

  function renderGuidance(r, t, present) {
    var st = r.seg.state();
    var total = C().REQUIRED_REPS;
    var inRep = st.phase === 'wait-hand' || st.phase === 'rep';
    if (st.phase === 'rest') {
      el.prompt.textContent = 'REST';
      el.prompt.className = 'gc-prompt rest';
    } else {
      el.prompt.textContent = 'SIGN ' + Math.min(st.repIndex, total) + ' of ' + total;
      el.prompt.className = 'gc-prompt sign';
    }
    setDots(st.repsDone, inRep);

    var hint = null;
    var inPhaseMs = st.phaseStartMs === null ? 0 : t - st.phaseStartMs;
    if (st.phase === 'wait-hand' && !present && inPhaseMs >= C().NO_HAND_HINT_MS) {
      hint = 'Hand not visible. Move closer or improve the lighting.';
    } else if (st.phase === 'rest' && present && inPhaseMs >= C().NO_HAND_HINT_MS) {
      hint = 'Lower your hands first.';
    }
    setHint(hint);
  }

  function stopLive(r) {
    if (r.unsub) { r.unsub(); r.unsub = null; }
    if (r.tailTimer) { clearTimeout(r.tailTimer); r.tailTimer = null; }
    if (r.clockTimer) { clearInterval(r.clockTimer); r.clockTimer = null; }
    if (r.startTimer) { clearTimeout(r.startTimer); r.startTimer = null; }
    if (r.onTrackEnded) {
      r.tracks.forEach(function (t) { t.removeEventListener('ended', r.onTrackEnded); });
      r.onTrackEnded = null;
    }
  }

  function stopForReview(r) {
    if (rec !== r || r.discarded) return;
    stopLive(r);
    try {
      r.recorder.stop(); // -> onstop -> finishRecording
    } catch (e) {
      console.warn('[gesture-capture-ui] MediaRecorder.stop failed:', e);
      failRecording(MSG.cameraStopped);
    }
  }

  function finishRecording(r) {
    if (rec !== r) return;
    // A camera track that really ends can make the recorder stop on its own, and this onstop can
    // run before the track's 'ended' listener: never review a partial recording.
    if (!r.done || !streamIsLive(session.stream)) { failRecording(MSG.cameraStopped); return; }
    rec = null;
    var type = (r.recorder.mimeType || 'video/webm').split(';')[0];
    var b = new Blob(r.chunks, { type: type });
    r.chunks = [];
    if (!b.size) { showError(MSG.cameraStopped); return; }
    blob = b;
    reviewCount = r.seg.state().repsDone;
    showReview();
  }

  // Throws the current recording away (recorder stopped, subscription and timers gone, chunks
  // dropped). Safe to call when nothing is recording.
  function discardRecording() {
    var r = rec;
    if (!r) return;
    rec = null;
    r.discarded = true;
    stopLive(r);
    try {
      if (r.recorder.state !== 'inactive') r.recorder.stop();
    } catch (e) { /* already stopped */ }
    r.chunks = [];
  }

  function failRecording(message) {
    discardRecording();
    dropBlob();
    showError(message);
  }

  // ── Review ──
  function showReview() {
    mode = 'review';
    blobUrl = URL.createObjectURL(blob);
    el.review.src = blobUrl;
    var n = reviewCount;
    view({
      review: true,
      msg: n + (n === 1 ? ' sign found' : ' signs found'),
      actions: ['save', 'redo'],
    });
    el.save.disabled = n !== C().REQUIRED_REPS;
    var p = el.review.play();
    if (p && typeof p.catch === 'function') p.catch(function (e) { console.warn('[gesture-capture-ui] review play failed:', e); });
  }

  // ── Processing ──
  async function saveRecording() {
    if (mode !== 'review' || !blob || reviewCount !== C().REQUIRED_REPS) return;
    var myGen = gen;
    var theBlob = blob;
    var ctrl = new AbortController();
    abortCtrl = ctrl;
    mode = 'processing';
    el.review.pause();
    view({ review: true, msg: 'Processing… 0%', progress: 0 });

    var det = null;
    var result = null;
    var failure = null;
    try {
      det = await recorderApi().createVideoDetector();
      if (myGen !== gen) return; // cancelled while waiting: finally releases det
      detector = det;
      result = await window.VideoLandmarks.extractVideoLandmarks(theBlob, {
        detector: det,
        fps: C().PROCESS_FPS,
        signal: ctrl.signal,
        onProgress: function (done, total) {
          if (myGen !== gen || !total) return;
          var f = done / total;
          setMsg('Processing… ' + Math.round(f * 100) + '%', false);
          setProgress(f);
        },
      });
    } catch (e) {
      failure = e;
    } finally {
      if (det) {
        try { det.release(); } catch (e) { console.warn('[gesture-capture-ui] detector release failed:', e); }
      }
      if (detector === det) detector = null;
    }
    if (myGen !== gen) return;
    abortCtrl = null;
    dropBlob(); // the landmarks are all that is needed from here on

    if (failure) {
      if (failure.name === 'AbortError') return;
      showError('Could not process the video: ' + (failure.message || String(failure)));
      return;
    }

    var seg = core().segmentFrames(
      result.frames.map(function (f) { return { t: f.t, handPresent: f.hands.length > 0 }; }),
      { endMs: result.durationMs }
    );
    if (!seg.ok) {
      showError(segmentFailureMessage(seg));
      return;
    }

    pending = {
      label: session.label,
      signSet: session.signSet,
      category: session.category,
      meta: {
        videoWidth: result.videoWidth,
        videoHeight: result.videoHeight,
        fps: result.fps,
        input: result.input,
      },
      reps: seg.reps.map(function (rep) {
        return {
          repIndex: rep.index,
          frames: result.frames.slice(rep.startFrame, rep.endFrame + 1),
          saved: false,
          res: null,
        };
      }),
      lastRes: null,
    };
    runSaves();
  }

  function segmentFailureMessage(seg) {
    var total = C().REQUIRED_REPS;
    if (seg.reason === 'rep-too-long') return MSG.tooLong;
    if (seg.reason === 'no-rest') return MSG.noRest;
    var n = seg.repsFound;
    // too-many-reps can also mean "3 closed reps plus a 4th still open at the end".
    if (seg.reason === 'too-many-reps' && n <= total) n = total + 1;
    return 'The video showed ' + n + ' signs, not ' + total + '. Please redo.';
  }

  // ── Saving ── (Cancel hidden from the first save until all 3 finish, or one fails)
  async function runSaves() {
    var p = pending;
    if (!p) return;
    var myGen = gen;
    var total = p.reps.length;
    mode = 'saving';
    view({ live: true, msg: 'Saving 1 of ' + total + '…', cancel: false });

    for (var i = 0; i < p.reps.length; i++) {
      var r = p.reps[i];
      if (r.saved) continue;
      setMsg('Saving ' + r.repIndex + ' of ' + total + '…', false);
      try {
        var res = await recorderApi().saveGestureSample(
          p.label, r.frames, p.signSet, null, null, p.category,
          {
            formatVersion: 3,
            source: 'video-live',
            repIndex: r.repIndex,
            videoWidth: p.meta.videoWidth,
            videoHeight: p.meta.videoHeight,
            fps: p.meta.fps,
            input: p.meta.input,
          }
        );
        if (myGen !== gen) return;
        r.saved = true;
        r.res = res;
        p.lastRes = res;
      } catch (e) {
        if (myGen !== gen) return;
        var savedN = savedCount(p);
        mode = 'error';
        view({
          live: true,
          msg: 'Saved ' + savedN + ' of ' + total + '. Sign ' + r.repIndex + ' was not saved: ' +
            withStop(e && e.message ? e.message : String(e)),
          msgError: true,
          actions: ['retrySave'],
        });
        return;
      }
    }
    await finishSaved(p, myGen);
  }

  function savedCount(p) {
    return p ? p.reps.filter(function (x) { return x.saved; }).length : 0;
  }

  function withStop(text) {
    return /[.!?]$/.test(text) ? text : text + '.';
  }

  // Invalidates the Sign-to-Text model + labels caches for a sign set (as the removed
  // confirmAndSave did). Resolves once the (guarded) IndexedDB removal settles.
  async function invalidateCaches(lang) {
    try { localStorage.removeItem('sining_kamay_labels_' + lang); } catch (e) { /* storage blocked */ }
    try {
      if (window.tf && window.tf.io && typeof window.tf.io.removeModel === 'function') {
        await window.tf.io.removeModel('indexeddb://sining-kamay-model-' + lang);
      }
    } catch (e) { /* the model may not exist yet - safe to ignore */ }
  }

  // Post-save steps, run once when a recording leaves the mode with at least one rep saved:
  // after all 3 saves (Done) or on Cancel after a hard save failure. Invalidate caches, reload the
  // dataset (which rebuilds the per-label sample/frame tally from the server), refresh the sample
  // line, close, toast.
  async function finishSaved(p, myGen) {
    var total = p.reps.length;
    var n = savedCount(p);
    mode = 'finishing';
    view({ live: true, msg: el.msg.textContent, msgError: el.msg.classList.contains('error'), cancel: false });
    await invalidateCaches(p.signSet);
    if (typeof window.reloadDataset === 'function') {
      try { await window.reloadDataset(); } catch (e) { console.warn('[gesture-capture-ui] reloadDataset failed:', e); }
    }
    if (myGen !== gen) return;
    // No frameCount here: reloadDataset() already counted the new samples' frames.
    if (typeof window.onCaptureSamplesSaved === 'function') {
      window.onCaptureSamplesSaved({
        label: p.label,
        signLanguage: p.signSet,
        labelSampleCount: p.lastRes ? p.lastRes.labelSampleCount : undefined,
      });
    }
    var label = p.label;
    close();
    toast((n === total ? total : n + ' of ' + total) + ' samples saved for “' + label + '”.');
  }

  function onCancel() {
    if (mode === 'error' && savedCount(pending) > 0) { finishSaved(pending, gen); return; }
    close();
  }

  // pagehide cannot await: invalidate the caches (fire-and-forget) if any rep was saved, then close.
  function onPageHide() {
    if (savedCount(pending) > 0) invalidateCaches(pending.signSet);
    close();
  }

  // ── Errors ──
  function showError(message) {
    mode = 'error';
    view({ live: true, msg: message, msgError: true, actions: ['redo'] });
  }

  window.addEventListener('pagehide', onPageHide);

  window.GestureCaptureUI = { open: open, close: close, streamIsLive: streamIsLive };
})();
