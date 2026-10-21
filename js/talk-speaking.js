// js/talk-speaking.js
// Real speech capture for talk.html's Speak-or-Type screen: Vosk (loaded by js/talk-loader.js) →
// live transcript in #speaking-input. Logic ported from archive/script.js's
// VoskSpeechRecognition + mic toggle (line refs in comments). Contract: leave() stops every
// audio track, closes the AudioContext, removes the recognizer (js/vosk.js: KaldiRecognizer.remove()
// frees it in the worker; measured) and never touches the loaded model (TalkLoader.voskModel) — the
// model is a page-lifetime resource.
//
// Deviation from archive/script.js:263-286 (measured, see the task report): js/vosk.js implements
// KaldiRecognizer.on() as model.addEventListener(...) with NO removal and NO recognizerId filter, so
// every capture would leave two listeners on the model that all later captures also trigger (text
// written N times after N captures). Instead this module registers ONE result/partialresult listener
// pair per model and accepts only events whose recognizerId is the current recognizer's.
//
// pi-fixes 2026-10-21 (docs/reports/2026-10-21-pi-fixes-final.md, items 11-13):
// - Live: the partial result is shown while speaking, each final chunk (Vosk's own end-of-utterance)
//   is committed at a pause; the field scrolls to the newest words, so 10+ s of speech stays visible.
// - Stop flushes: the mic closes, then KaldiRecognizer.remove() makes the worker answer every audio
//   chunk still queued and finally its FinalResult() (js/vosk.js worker removeRecognizer). The final
//   answer is recognised by count (one answer per chunk sent, plus one for remove). Meanwhile
//   "Processing…" shows and the screen's buttons are off — only if speech was heard (text, or audio
//   above SPEECH_RMS). It ends on the final text, on an empty result ("Walang narinig, subukan ulit")
//   or after FLUSH_TIMEOUT_MS (then the text so far, partial included, is used). Never stuck.
// - Audio goes to Vosk at 16 kHz mono (AudioContext sampleRate 16000; the browser resamples). Measured
//   on the laptop: the worker needs 0.6-1.4 s per second of audio at 16 kHz and at 48 kHz alike, so the
//   delay after speaking is the worker's backlog. Hence the silence gate (onaudioprocess): the long
//   part of a pause is not sent, and the worker catches up while nobody speaks.
(function () {
  'use strict';

  var MIC_KEY = 'selectedMicId';          // archive/script.js:238, 1050-1072
  var SAMPLE_RATE = 16000;                // what the small Vosk model is trained on
  var BUFFER_SIZE = 2048;                 // samples per chunk: 128 ms at 16 kHz
  var FLUSH_TIMEOUT_MS = 4000;
  var SPEECH_RMS = 0.02;                  // a chunk louder than this counts as "speech heard"
  var QUIET_RMS = 0.006;                  // a chunk quieter than this is silence (silence gate)
  var KEEP_QUIET_CHUNKS = 6;              // ~0.77 s of a pause still sent (Vosk ends an utterance after 0.5 s)
  var HINT_MS = 3500;
  var NOTHING_HEARD = 'Walang narinig, subukan ulit';
  var cb = {};
  var lang = 'en-US';
  var active = false;
  var starting = false;
  var capturing = false;
  var processing = false;                 // Stop pressed, waiting for the recognizer's final result
  var gen = 0;
  var stream = null;
  var audioCtx = null;
  var source = null;
  var processor = null;
  var recognizer = null;
  var boundModel = null;                  // the model our single listener pair is attached to
  var finalText = '';
  var partialText = '';
  var voiced = false;                     // some chunk was above SPEECH_RMS this capture
  var chunksSent = 0;                     // audio chunks sent to the current recognizer
  var answers = 0;                        // worker answers (result/partialresult) for it
  var flushId = null;                     // recognizer id being flushed (processing)
  var flushTimer = null;
  var hint = '';
  var hintTimer = null;
  var micBtn = null;
  var micLabel = null;
  var input = null;

  function modelReady() {
    return !!(window.TalkLoader && window.TalkLoader.voskModel);
  }
  // The Vosk model loads lazily (js/talk-loader.js startSpeech), so "not ready" is usually "still
  // loading", not "failed".
  function modelLoading() {
    var L = window.TalkLoader;
    return !!(L && !L.voskModel && (!L.speechStarted || !L.speechStarted() || !L.isSettled('speech')));
  }

  function setLabel(text) { if (micLabel) micLabel.textContent = text; }

  function syncMic() {
    if (!micBtn) return;
    var fil = lang === 'fil-PH';
    var unavailable = !modelReady();
    micBtn.disabled = fil || unavailable || processing;
    micBtn.classList.toggle('listening', capturing);
    micBtn.setAttribute('aria-pressed', capturing ? 'true' : 'false');
    if (fil) setLabel('Voice input disabled in Filipino');       // archive/script.js:479
    else if (unavailable && modelLoading()) setLabel('Inihahanda ang mikropono… / Getting the mic ready…');
    else if (unavailable) setLabel('Microphone not available');
    else if (processing) setLabel('Processing…');
    else if (capturing) setLabel('Tap to Stop');                  // archive/script.js:584-586
    else setLabel(hint || 'Tap to Speak');
    // The visible label is the button's accessible name too: keep the two in step.
    if (micLabel) micBtn.setAttribute('aria-label', micLabel.textContent);
  }

  function changed() {
    syncMic();
    if (cb.onChange) cb.onChange();
  }

  function showHint(text) {
    clearTimeout(hintTimer);
    hint = text;
    hintTimer = setTimeout(function () { hint = ''; syncMic(); }, HINT_MS);
  }

  function combined() {
    return (finalText + (finalText && partialText ? ' ' : '') + partialText).trim();
  }

  function renderTranscript() {
    input.value = combined();
    input.scrollLeft = input.scrollWidth;      // keep the newest words in view (long speech)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (cb.onTranscript) cb.onTranscript();
  }

  // archive/script.js:1050-1063: keep the saved mic if it still exists, else prefer the kiosk's
  // USB mic (label contains "ab13x" or "usb audio"). Labels are only readable after mic
  // permission has been granted, so this also runs after a successful capture start.
  function autoSelectMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var mics = devices.filter(function (d) { return d.kind === 'audioinput'; });
      var saved = null;
      try { saved = localStorage.getItem(MIC_KEY); } catch (e) { /* storage blocked */ }
      if (saved && mics.some(function (m) { return m.deviceId === saved; })) return;
      var target = mics.filter(function (m) {
        var label = (m.label || '').toLowerCase();
        return label.indexOf('ab13x') !== -1 || label.indexOf('usb audio') !== -1;
      })[0];
      if (target) {
        try { localStorage.setItem(MIC_KEY, target.deviceId); } catch (e) { /* storage blocked */ }
      }
    }).catch(function (err) { console.error('[talk-speaking] enumerateDevices failed:', err); });
  }

  function audioConstraints(useSavedId) {
    var c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      channelCount: { ideal: 1 }, sampleRate: { ideal: SAMPLE_RATE } };
    var saved = null;
    if (useSavedId) { try { saved = localStorage.getItem(MIC_KEY); } catch (e) { /* storage blocked */ } }
    if (saved) c.deviceId = { exact: saved };
    return c;
  }

  // The saved mic may have been unplugged (OverconstrainedError / NotFoundError): retry once
  // with the default device instead of failing outright — but only if this start is still
  // wanted (screen not left, no newer start), or the retry would open the hardware for nobody.
  async function acquireMic(myGen) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints(true) });
    } catch (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        if (!active || myGen !== gen || lang === 'fil-PH') throw err;   // startCapture ignores a stale start's error
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints(false) });
      }
      throw err;
    }
  }

  // An AudioContext at 16 kHz fed by the mic (the browser resamples); the device's own rate if this
  // browser cannot connect a mic to a context of another rate.
  function openAudio(s) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    try {
      audioCtx = new Ctx({ sampleRate: SAMPLE_RATE });
      source = audioCtx.createMediaStreamSource(s);
    } catch (e) {
      console.warn('[talk-speaking] no 16 kHz capture here, using the device rate:', e);
      if (audioCtx) { try { audioCtx.close(); } catch (e2) { /* already */ } }
      audioCtx = new Ctx();
      source = audioCtx.createMediaStreamSource(s);
    }
  }

  // Releases the mic and the audio graph (not the recognizer).
  function closeMic() {
    capturing = false;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (e) { /* already */ } processor = null; }
    if (source) { try { source.disconnect(); } catch (e) { /* already */ } source = null; }
    if (audioCtx && audioCtx.state !== 'closed') {
      try { var closing = audioCtx.close(); if (closing && closing.catch) closing.catch(function () { /* already closed */ }); } catch (e) { /* already */ }
    }
    audioCtx = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  // js/vosk.js KaldiRecognizer.remove() makes the worker delete the Kaldi recognizer and its buffer
  // and post back one final 'result'. The guard keeps this safe if a different Vosk build lacks it.
  // The MODEL is never touched.
  function removeRecognizer(rec) {
    try { if (rec && typeof rec.remove === 'function') rec.remove(); } catch (e) { /* best effort */ }
  }

  function endProcessing() {
    processing = false;
    flushId = null;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  function teardown() {
    closeMic();
    if (recognizer) { removeRecognizer(recognizer); recognizer = null; }
    endProcessing();
  }

  function fail(kind, message) {
    teardown();
    finalText = '';
    partialText = '';
    changed();
    if (cb.onMicError) cb.onMicError(kind, message);
  }

  // Puts the finished transcript into the field (formatGrammar-tidied), or the "nothing heard" hint.
  function deliver(text) {
    finalText = '';
    partialText = '';
    try {
      if (text) {
        var tidy = text;
        try { if (window.SignPlayer) tidy = window.SignPlayer.formatGrammar(text); }
        catch (err) { console.error('[talk-speaking] formatGrammar failed, keeping the raw transcript:', err); tidy = text; }
        input.value = tidy;
        input.scrollLeft = 0;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (cb.onTranscript) cb.onTranscript();
      } else {
        if (input.value !== '') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        showHint(NOTHING_HEARD);
      }
    } finally {
      changed();                               // the hardware is already released: always tell the page
    }
  }

  // Single page-lifetime listener pair (see header). message = { event, recognizerId, result }.
  function onVoskEvent(ev) {
    var message = ev.detail;
    if (!message) return;
    var live = capturing && recognizer && message.recognizerId === recognizer.id;
    var flushing = processing && flushId && message.recognizerId === flushId;
    if (!live && !flushing) return;
    answers++;
    if (message.event === 'result') {                      // archive/script.js:263-274
      var text = message.result && message.result.text;
      if (text) {
        finalText += (finalText ? ' ' : '') + text;
        partialText = '';
        renderTranscript();
      }
    } else if (message.event === 'partialresult') {        // archive/script.js:276-286
      // The worker posts a partialresult for every audio chunk it does not finalise, silence
      // included (~8 a second). Re-rendering each one would wipe typed text the moment the mic
      // opens and, through the bubbling 'input' event, re-arm talk.html's idle timer forever
      // (archive/script.js:276-286 guards this with `&& text`): only react when the partial changed.
      var partial = (message.result && message.result.partial) || '';
      if (partial !== partialText) {
        partialText = partial;
        renderTranscript();
      }
    }
    // The answer to remove() is the last one: one per chunk sent, plus one.
    if (flushing && answers >= chunksSent + 1) {
      var got = finalText.trim();
      endProcessing();
      deliver(got);
    }
  }

  function bindModel(model) {
    if (boundModel === model) return;
    model.addEventListener('result', onVoskEvent);
    model.addEventListener('partialresult', onVoskEvent);
    boundModel = model;
  }

  async function startCapture() {
    if (capturing || starting || processing || !active) return;
    if (!modelReady()) { fail('model', 'Vosk model not loaded'); return; }
    var model = window.TalkLoader.voskModel;
    starting = true;
    clearTimeout(hintTimer);
    hint = '';
    var myGen = ++gen;
    changed();                                  // isBusy() just became true: gate Translate now, not when the mic opens
    try {
      var s = await acquireMic(myGen);
      // Discard the mic if the screen was left, a newer start replaced this one, or the language
      // was switched to Filipino (no voice input there) while getUserMedia was in flight.
      if (!active || myGen !== gen || lang === 'fil-PH') {
        s.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      stream = s;
      openAudio(stream);
      bindModel(model);
      recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
      finalText = '';
      partialText = '';
      voiced = false;
      chunksSent = 0;
      answers = 0;
      processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      var quietRun = 0;
      var preRoll = null;
      processor.onaudioprocess = function (event) {         // archive/script.js:288-297
        if (!recognizer || !capturing) return;
        var d = event.inputBuffer.getChannelData(0);
        var sum = 0;
        for (var i = 0; i < d.length; i++) sum += d[i] * d[i];
        var rms = Math.sqrt(sum / d.length);
        if (rms > SPEECH_RMS) voiced = true;
        // Silence gate: after KEEP_QUIET_CHUNKS quiet chunks (enough for Vosk's end-of-utterance)
        // the rest of a pause is not sent, so the worker can catch up; the last quiet chunk is kept
        // and sent first when sound comes back (the start of the next word).
        if (rms < QUIET_RMS) {
          quietRun++;
          if (quietRun > KEEP_QUIET_CHUNKS) { preRoll = d.slice(); return; }
        } else {
          quietRun = 0;
        }
        try {
          if (preRoll) { recognizer.acceptWaveformFloat(preRoll, audioCtx.sampleRate); chunksSent++; preRoll = null; }
          recognizer.acceptWaveform(event.inputBuffer);
          chunksSent++;
        } catch (err) { console.error('[talk-speaking] acceptWaveform failed:', err); }
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      starting = false;                                      // starting -> capturing: isBusy() stays true, one notification
      capturing = true;
      console.log('[talk-speaking] capturing at ' + audioCtx.sampleRate + ' Hz');
      changed();
      autoSelectMic();                                       // labels are readable now
    } catch (err) {
      if (myGen !== gen) return;               // failed after leave(): nothing of ours left to report or tear down
      console.error('[talk-speaking] capture failed:', err);
      starting = false;                        // before fail(), so its changed() already sees isBusy() false
      fail('capture', (err && err.message) || String(err));
    } finally {
      // Only a start that is still current and still pending gets here with starting === true
      // (leave(), setLanguage() and the input-focus discard, discardPendingStart(), reset the flag
      // themselves and bump gen; do not clobber a newer start).
      if (myGen === gen && starting) {
        starting = false;
        changed();
      }
    }
  }

  // Stop (see header): flush the recognizer, then close the mic; "Processing…" until the final text.
  // flush === false (leaving the screen / switching to Filipino): keep what is there now, no wait.
  function stopCapture(flush) {
    if (!capturing) return;
    var rec = recognizer;
    recognizer = null;
    if (flush === false || !rec) {
      var now = combined();
      removeRecognizer(rec);
      closeMic();
      deliver(now);
      return;
    }
    var heard = voiced || combined() !== '';
    removeRecognizer(rec);                     // the worker answers what is queued, then FinalResult()
    closeMic();
    if (!heard) {
      // its final 'result' arrives for an id that is no longer current: ignored
      deliver('');
      return;
    }
    processing = true;
    flushId = rec.id;
    var myGen = gen;
    flushTimer = setTimeout(function () {
      if (!processing || myGen !== gen) return;
      console.warn('[talk-speaking] no final result after ' + FLUSH_TIMEOUT_MS + ' ms: using the text so far');
      var got = combined();
      endProcessing();
      deliver(got);
    }, FLUSH_TIMEOUT_MS);
    changed();
  }

  // Abandon a start whose getUserMedia is still in flight: the bumped gen makes startCapture stop the
  // stream when it resolves (its `myGen !== gen` guard). Returns true if a start was discarded; the
  // caller then calls changed() (once, together with whatever else it changed) so the page re-gates
  // Translate and the mic button re-syncs.
  function discardPendingStart() {
    if (!starting) return false;
    gen++;
    starting = false;
    return true;
  }

  function onMicTap() {
    if (micBtn.disabled || processing) return;
    if (capturing) stopCapture(); else startCapture();
  }

  function init(callbacks) {
    cb = callbacks || {};
    micBtn = document.getElementById('speaking-mic-btn');
    micLabel = document.querySelector('.speaking-mic-label');
    input = document.getElementById('speaking-input');
    micBtn.addEventListener('click', onMicTap);
    // Typing and talking are alternatives: raising the keyboard ends a capture in progress, or
    // discards one whose getUserMedia is still pending (the keyboard hides the mic row, so a mic
    // that went live afterwards would have no visible indicator).
    input.addEventListener('focus', function () {
      if (processing) { input.blur(); return; }
      if (capturing) stopCapture(); else if (discardPendingStart()) changed();
    });
    syncMic();
    // The Vosk model may still be loading when this runs (and when the user reaches Speak or Type):
    // re-sync the mic button whenever the load queue changes so it enables once the model is there.
    // syncMic() only reads modelReady()/lang/capturing and rewrites the button state: safe any time.
    if (window.TalkLoader && window.TalkLoader.onChange) window.TalkLoader.onChange(syncMic);
  }

  function enter() {
    if (active) return;
    active = true;
    syncMic();
    autoSelectMic();
  }

  function leave() {
    if (!active) return;
    active = false;
    gen++;                                   // discards a getUserMedia still in flight
    if (capturing) stopCapture(false); else teardown();
    endProcessing();                         // a flush still waiting: dropped (the page empties the field)
    starting = false;
    clearTimeout(hintTimer);
    hint = '';
    changed();
  }

  function setLanguage(next) {
    if (next === lang || processing) return;
    lang = next;
    if (lang === 'fil-PH') {                              // archive/script.js:469-471
      if (capturing) stopCapture(false);
      discardPendingStart();                              // a getUserMedia still in flight: no voice input in Filipino
    }
    changed();
  }

  window.TalkSpeaking = {
    init: init,
    enter: enter,
    leave: leave,
    setLanguage: setLanguage,
    getLanguage: function () { return lang; },
    isCapturing: function () { return capturing; },
    isProcessing: function () { return processing; },
    // true from the moment a start is requested (getUserMedia in flight) until capture AND its
    // flush end: the page gates anything that must not run with a mic that is about to go live.
    isBusy: function () { return starting || capturing || processing; }
  };
})();
