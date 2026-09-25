// js/talk-speaking.js
// Real speech capture for talk.html's Speak-or-Type screen: Vosk (already loaded by
// js/talk-loader.js) → live transcript in #speaking-input. Logic ported from archive/script.js's
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
(function () {
  'use strict';

  var MIC_KEY = 'selectedMicId';          // archive/script.js:238, 1050-1072
  var cb = {};
  var lang = 'en-US';
  var active = false;
  var starting = false;
  var capturing = false;
  var gen = 0;
  var stream = null;
  var audioCtx = null;
  var source = null;
  var processor = null;
  var recognizer = null;
  var boundModel = null;                  // the model our single listener pair is attached to
  var finalText = '';
  var partialText = '';
  var micBtn = null;
  var micLabel = null;
  var input = null;

  function modelReady() {
    return !!(window.TalkLoader && window.TalkLoader.voskModel);
  }

  function setLabel(text) { if (micLabel) micLabel.textContent = text; }

  function syncMic() {
    if (!micBtn) return;
    var fil = lang === 'fil-PH';
    var unavailable = !modelReady();
    micBtn.disabled = fil || unavailable;
    micBtn.classList.toggle('listening', capturing);
    micBtn.setAttribute('aria-pressed', capturing ? 'true' : 'false');
    if (fil) setLabel('Voice input disabled in Filipino');       // archive/script.js:479
    else if (unavailable) setLabel('Microphone not available');
    else setLabel(capturing ? 'Tap to Stop' : 'Tap to Speak');    // archive/script.js:584-586
    // The visible label is the button's accessible name too: keep the two in step.
    if (micLabel) micBtn.setAttribute('aria-label', micLabel.textContent);
  }

  function changed() {
    syncMic();
    if (cb.onChange) cb.onChange();
  }

  function renderTranscript() {
    var combined = (finalText + (finalText && partialText ? ' ' : '') + partialText).trim();
    input.value = combined;
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
    var c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
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

  function teardown() {
    capturing = false;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch (e) { /* already */ } processor = null; }
    if (source) { try { source.disconnect(); } catch (e) { /* already */ } source = null; }
    if (audioCtx && audioCtx.state !== 'closed') {
      try { var closing = audioCtx.close(); if (closing && closing.catch) closing.catch(function () { /* already closed */ }); } catch (e) { /* already */ }
    }
    audioCtx = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (recognizer) {
      // js/vosk.js KaldiRecognizer.remove() makes the worker delete the Kaldi recognizer and its buffer
      // (and post back one final 'result', which onVoskEvent ignores: no recognizer is current). The
      // guard keeps this safe if a different Vosk build lacks it. The MODEL is never touched.
      try { if (typeof recognizer.remove === 'function') recognizer.remove(); } catch (e) { /* best effort */ }
      recognizer = null;
    }
  }

  function fail(kind, message) {
    teardown();
    finalText = '';
    partialText = '';
    changed();
    if (cb.onMicError) cb.onMicError(kind, message);
  }

  // Single page-lifetime listener pair (see header). message = { event, recognizerId, result }.
  function onVoskEvent(ev) {
    var message = ev.detail;
    if (!capturing || !recognizer || !message || message.recognizerId !== recognizer.id) return;
    if (message.event === 'result') {                      // archive/script.js:263-274
      var text = message.result && message.result.text;
      if (text) {
        finalText += (finalText ? ' ' : '') + text;
        partialText = '';
        renderTranscript();
      }
    } else if (message.event === 'partialresult') {        // archive/script.js:276-286
      // The worker posts a partialresult for every audio chunk it does not finalise, silence
      // included (~7-12 a second). Re-rendering each one would wipe typed text the moment the mic
      // opens and, through the bubbling 'input' event, re-arm talk.html's idle timer forever
      // (archive/script.js:276-286 guards this with `&& text`): only react when the partial changed.
      var partial = (message.result && message.result.partial) || '';
      if (partial === partialText) return;
      partialText = partial;
      renderTranscript();
    }
  }

  function bindModel(model) {
    if (boundModel === model) return;
    model.addEventListener('result', onVoskEvent);
    model.addEventListener('partialresult', onVoskEvent);
    boundModel = model;
  }

  async function startCapture() {
    if (capturing || starting || !active) return;
    if (!modelReady()) { fail('model', 'Vosk model not loaded'); return; }
    var model = window.TalkLoader.voskModel;
    starting = true;
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
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      bindModel(model);
      recognizer = new model.KaldiRecognizer(audioCtx.sampleRate);
      finalText = '';
      partialText = '';
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function (event) {         // archive/script.js:288-297
        if (recognizer && capturing) {
          try { recognizer.acceptWaveform(event.inputBuffer); } catch (err) { console.error('[talk-speaking] acceptWaveform failed:', err); }
        }
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      starting = false;                                      // starting -> capturing: isBusy() stays true, one notification
      capturing = true;
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

  // Finalise: append the last partial (archive/script.js:688-691), tidy the text with formatGrammar,
  // release the hardware. A late 'result' after this is ignored (capturing === false).
  function stopCapture() {
    if (!capturing) return;
    var text = (finalText + (finalText && partialText ? ' ' : '') + partialText).trim();
    teardown();
    finalText = '';
    partialText = '';
    try {
      if (text) {
        var tidy = text;
        try { if (window.SignPlayer) tidy = window.SignPlayer.formatGrammar(text); }
        catch (err) { console.error('[talk-speaking] formatGrammar failed, keeping the raw transcript:', err); tidy = text; }
        input.value = tidy;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (cb.onTranscript) cb.onTranscript();
      }
    } finally {
      changed();                               // the hardware is already released: always tell the page
    }
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
    if (micBtn.disabled) return;
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
    input.addEventListener('focus', function () { if (capturing) stopCapture(); else if (discardPendingStart()) changed(); });
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
    if (capturing) stopCapture(); else teardown();
    starting = false;
    changed();
  }

  function setLanguage(next) {
    if (next === lang) return;
    lang = next;
    if (lang === 'fil-PH') {                              // archive/script.js:469-471
      if (capturing) stopCapture();
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
    // true from the moment a start is requested (getUserMedia in flight) until capture ends:
    // the page gates anything that must not run with a mic that is about to go live.
    isBusy: function () { return starting || capturing; }
  };
})();
