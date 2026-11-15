// js/seq-live.js
// Whole-sign recognition in the browser (seq-recognition phase, 2026-11-15): loads models/seq_<LANG>.bin and feeds
// the camera's MediaPipe results to js/seq-recognizer.js. Used by Let's Talk (js/talk-signing.js) and Train
// Gestures Steps 3 / 4 (js/gesture-training-ui.js). Needs js/seq-features.js, js/seq-recognizer.js and
// window.GestureDataRecorder.onHandResults (js/gesture-data.js).
// When the model file is missing (404) or cannot be read, model() stays null and the page keeps the frame k-NN
// as before: nothing breaks on a kiosk that has no seq model yet.
// ?seq=off in the page address turns it off (to compare with the frame k-NN).
(function () {
  'use strict';

  var OFF = /(?:^|[?&])seq=off(?:&|$)/.test(location.search);
  var models = {};        // lang -> Promise<model|null>
  var current = null;     // the model in use
  var rec = null, unsub = null, listener = null;

  function load(lang) {
    if (OFF) return Promise.resolve(null);
    if (!models[lang]) {
      models[lang] = fetch('models/seq_' + lang + '.bin', { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      }).then(function (buf) {
        var m = window.SeqFeatures.decode(buf);
        console.log('[SEQ] ' + lang + ' model: ' + m.rowLabel.length + ' rows, ' + m.labels.length + ' signs, built ' + (m.header.buildDate || '?'));
        return m;
      }).catch(function (e) {
        console.warn('[SEQ] ' + lang + ' model not used (' + (e && e.message ? e.message : e) + '): the frame k-NN stays');
        delete models[lang];
        return null;
      });
    }
    return models[lang];
  }

  // Loads lang's model and makes it the one in use. -> Promise<boolean> (a model is in use).
  function use(lang) {
    return load(lang).then(function (m) {
      current = m;
      if (rec) { rec.setModel(m); rec.reset(); }
      return !!m;
    });
  }

  // Starts feeding the recognizer; onEvent gets its events (js/seq-recognizer.js). One listener at a time.
  function start(onEvent) {
    stop();
    listener = onEvent;
    rec = window.SeqRecognizer.create({ model: current, onEvent: function (e) { if (listener) listener(e); } });
    unsub = window.GestureDataRecorder.onHandResults(function (results) {
      if (!rec || !current) return;
      rec.push(window.SeqRecognizer.frameFromResults(results, performance.now()));
    });
  }
  function stop() {
    if (unsub) { unsub(); unsub = null; }
    rec = null;
    listener = null;
  }

  window.SeqLive = {
    load: load,
    use: use,
    start: start,
    stop: stop,
    reset: function () { if (rec) rec.reset(); },
    model: function () { return current; },
    active: function () { return !!current && !!rec; },
    forget: function (lang) { delete models[lang]; },   // after Compile wrote a new file
    _push: function (frame) { if (rec) rec.push(frame); }   // tests: frames without a camera
  };
})();
