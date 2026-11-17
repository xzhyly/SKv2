// js/glove-assist.js
// Glove-assisted recognition, the live part (glove-hw Phase 2, docs/superpowers/specs/2026-10-21-glove-hardware-design.md
// 2.2-2.3): the "🧤 Gloves OFF / ON" button (Train Gestures Step 3), the 🧤 chip on the Let's Talk camera
// (glove-chip phase, docs/design/glove-chip-wireframe.html), and apply(scores, model) that the recognizers call on
// every k-NN result.
// Needs js/glove.js (window.SKGlove) and js/glove-bend.js (window.GloveBend); uses
// window.GestureDataRecorder.onHandResults when it exists (the handedness of the frame being classified).
//
// apply() returns the scores unchanged unless ALL of these hold (better no help than wrong help):
//   the button is ON; SKGlove.ready(); the setup has the camera step (cam.mirror); glove data younger than 1 s;
//   the gloves are being worn (some finger moved >= 0.05 in the last 3 s); MediaPipe's last frame has 1-2 hands,
//   each with a handedness score >= 0.8.
// The ON state is never stored: a page load starts OFF. reset() turns it OFF (a new conversation).
(function () {
  'use strict';

  // Glove data older than this is not used. 1 s, not less: MediaPipe holds the page's only thread while it
  // detects (about 1.1 s per frame in the cloud test container), and the glove's lines wait behind it.
  var FRESH_MS = 1000;
  var HAND_SCORE_DEFAULT = 0.8;
  var HAND_SCORE_GLOVE = 0.55;
  var IDLE_MS = 3000;
  var IDLE_MOVE = 0.05;
  var BARS_MS = 100;            // finger bars (Train Gestures Step 3 button only): at most 10 updates per second
  var BARS_KEY = 'sk_glove_bars';

  var on = false;
  var btn = null, barsEl = null, labelEl = null;
  var lastHands = null;         // [{ label, score }] of the last MediaPipe frame, in slot order
  var unsubHands = null;
  var moves = [];               // [{ at, v: [10 norms or null] }] for the not-worn rule
  var barsTimer = null, barsDirty = false;
  var lastInfo = { used: false, why: 'off' };

  function G() { return window.SKGlove; }
  function available() { return !!(G() && G().ready()); }
  function barsWanted() {
    try { return localStorage.getItem(BARS_KEY) !== '0'; } catch (e) { return true; }
  }
  function setBarsWanted(v) {
    try { localStorage.setItem(BARS_KEY, v ? '1' : '0'); } catch (e) { /* not stored */ }
  }

  // ── MediaPipe handedness of the frame being classified ──
  function watchHands() {
    if (unsubHands || !window.GestureDataRecorder || !window.GestureDataRecorder.onHandResults) return;
    unsubHands = window.GestureDataRecorder.onHandResults(function (results) {
      var hs = (results && results.multiHandedness) || [];
      lastHands = hs.map(function (h) { return { label: h.label, score: h.score }; });
    });
  }

  // ── not worn: every finger still for IDLE_MS ──
  function track(d) {
    if (!d || !d.hands) return;
    var now = Date.now();
    moves.push({ at: now, v: d.hands.L.norm.concat(d.hands.R.norm) });
    while (moves.length && now - moves[0].at > IDLE_MS) moves.shift();
  }
  function worn() {
    if (moves.length < 2 || moves[moves.length - 1].at - moves[0].at < IDLE_MS * 0.8) return true;   // not enough history yet
    for (var i = 0; i < 10; i++) {
      var lo = Infinity, hi = -Infinity;
      for (var k = 0; k < moves.length; k++) {
        var v = moves[k].v[i];
        if (v === null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo >= IDLE_MOVE) return true;
    }
    return false;
  }

  // The glove hands to compare for the frame, or a reason why not.
  function glovesForFrame() {
    var g = G();
    if (!on) return { why: 'off' };
    if (!available()) return { why: 'glove not ready' };
    var cfg = g.config();
    if (!cfg.cam) return { why: 'no camera setup' };
    var d = g.latest();
    if (!d || !d.hands || Date.now() - d.at > FRESH_MS) return { why: 'no fresh glove data' };
    if (!worn()) return { why: 'not worn' };
    var hs = lastHands;
    if (!hs || !hs.length || hs.length > 2) return { why: 'no hand in the frame' };
    var gloves = [];
    var minScore = on ? HAND_SCORE_GLOVE : HAND_SCORE_DEFAULT;
    for (var i = 0; i < hs.length; i++) {
      if (!(hs[i].score >= minScore) || (hs[i].label !== 'Left' && hs[i].label !== 'Right')) return { why: 'unsure which hand' };
      var side = hs[i].label === 'Left' ? 'L' : 'R';
      if (cfg.cam.mirror) side = side === 'L' ? 'R' : 'L';
      gloves.push(d.hands[side].norm);
    }
    return { gloves: gloves, w: cfg.w };
  }

  // scores: knnPredict's { label: 0..1 }; model: the loaded k-NN model ({ label: rows }).
  function apply(scores, model) {
    watchHands();
    var f = glovesForFrame();
    if (!f.gloves || !window.GloveBend) { lastInfo = { used: false, why: f.why || 'no GloveBend' }; return scores; }
    var r = window.GloveBend.rerank(scores, model, f.gloves, f.w);
    lastInfo = { used: true, dist: r.dist };
    return r.scores;
  }

  // ── the button (Train Gestures Step 3) ──
  function render() {
    if (!available() && on) on = false;   // unplugged / setup cleared: back to camera only
    if (chip) renderChip();
    if (!btn) return;
    var show = available();
    btn.hidden = !show;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    labelEl.textContent = on ? 'ON' : 'OFF';
    var bars = on && barsWanted();
    barsEl.hidden = !bars;
    btn.classList.toggle('bars', bars);
    if (bars && !barsTimer) barsTimer = setInterval(drawBars, BARS_MS);
    if (!bars && barsTimer) { clearInterval(barsTimer); barsTimer = null; }
  }
  function drawBars() {
    if (!barsDirty) return;
    barsDirty = false;
    var d = G().latest();
    if (!d || !d.hands) return;
    var i = 0;
    ['L', 'R'].forEach(function (h) {
      d.hands[h].norm.forEach(function (v) {
        var el = barsEl.children[i + (h === 'R' ? 1 : 0)];   // child 5 is the gap between the hands
        if (el) el.style.transform = 'scaleY(' + (v === null ? 0 : Math.max(0.06, v)).toFixed(2) + ')';
        i++;
      });
    });
  }
  function setOn(v) {
    on = !!v && available();
    moves = [];
    if (!on && hintEl) hideHint();
    render();
  }
  function reset() { setOn(false); hintArmed = true; }   // a new conversation: the first-ON hint shows again
  // Let's Talk: every Sign turn starts with the gloves OFF.
  function startTurn() { setOn(false); }

  // button: an empty <button>; it gets the icon, the ON/OFF label and the bars inside.
  function init(button) {
    btn = button;
    btn.innerHTML = '<span class="glove-ico" aria-hidden="true">&#129508;</span><span class="glove-txt"><span class="glove-word">Gloves </span><b class="glove-state">OFF</b></span>' +
      '<span class="glove-bars" aria-hidden="true" hidden>' + '<i></i><i></i><i></i><i></i><i></i><em></em><i></i><i></i><i></i><i></i><i></i>' + '</span>';
    labelEl = btn.querySelector('.glove-state');
    barsEl = btn.querySelector('.glove-bars');
    btn.addEventListener('click', function () { setOn(!on); });
    var g = G();
    if (g) {
      g.on('status', render);
      g.on('config', render);
      g.on('data', function (d) { track(d); barsDirty = true; });
    }
    render();
  }

  // ── the chip on the Let's Talk camera (glove-chip phase) ──
  // A 44 px pill in the camera's top-right corner, shown only while SKGlove.ready(). States: 'off'; 'on' (the
  // glove is used, or would be once a hand is in the frame); 'idle' (ON but apply() ignores the glove: no camera
  // step, data older than 1 s, not worn, unsure hand) shown as amber "Camera only", no popup. Same rules as apply()
  // (glovesForFrame), not new ones. While ON the state is re-checked every CHIP_MS; the DOM is touched only when
  // the state changes (renderChip compares first), never per glove line or per camera frame.
  var CHIP_MS = 250;
  var chip = null, chipTxt = null, chipState = '', chipTimer = null;
  function chipStateNow() {
    var g = G();
    if (!g || !g.isSupported()) return 'hidden';
    var st = g.status();
    if (st === 'connecting') return 'connecting';
    if (st !== 'connected') return 'disconnected';
    if (!g.ready()) return 'nocal';
    if (!on) return 'off';
    watchHands();
    var why = glovesForFrame().why;
    return !why || why === 'no hand in the frame' ? 'on' : 'idle';
  }
  function renderChip() {
    if (on && !chipTimer) chipTimer = setInterval(renderChip, CHIP_MS);
    if (!on && chipTimer) { clearInterval(chipTimer); chipTimer = null; }
    var s = chipStateNow();
    if (s === chipState) return;
    chipState = s;
    chip.hidden = s === 'hidden';
    chip.classList.toggle('on', s === 'on');
    chip.classList.toggle('idle', s === 'idle');
    chip.classList.toggle('disconnected', s === 'disconnected');
    chip.classList.toggle('connecting', s === 'connecting');
    chip.classList.toggle('nocal', s === 'nocal');
    chip.setAttribute('aria-pressed', s === 'on' || s === 'idle' ? 'true' : 'false');
    if (s === 'disconnected') chipTxt.textContent = '🔌 Connect Glove';
    else if (s === 'connecting') chipTxt.textContent = '⏳ Connecting…';
    else if (s === 'nocal') chipTxt.textContent = '⚠ Setup in Admin';
    else if (s === 'idle') chipTxt.textContent = 'Camera only';
    else if (s === 'on') chipTxt.textContent = '🧤 ON';
    else chipTxt.textContent = '🧤 Gloves';
  }

  // First-ON hint: a banner under the chips, on the first ON of a conversation only (reset() re-arms it, a page
  // load starts armed); hides after HINT_MS or on a tap, and when the gloves go OFF.
  var HINT_MS = 3000;
  var HINT = {
    fil: 'Suotin ang dalawang gloves — <b>kaliwa</b> at <b>kanan</b>. Itaas ang mga kamay at mag-sign gaya ng dati.',
    en: 'Wear both gloves — <b>left</b> and <b>right</b>. Raise your hands and sign as usual.'
  };
  var hintEl = null, hintLang = null, hintArmed = true, hintTimer = null;
  function showHint() {
    if (!hintEl) return;
    hintEl.innerHTML = HINT[hintLang && hintLang() === 'en' ? 'en' : 'fil'];
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, HINT_MS);
  }
  function hideHint() {
    clearTimeout(hintTimer);
    hintTimer = null;
    if (hintEl) hintEl.hidden = true;
  }

  // el: an empty <button> inside the camera box; it gets a status dot and the label.
  // opts.hint: an empty element under the chips for the first-ON hint; opts.lang(): 'en' or 'fil'.
  function initChip(el, opts) {
    opts = opts || {};
    chip = el;
    chip.innerHTML = '<span class="glove-chip-dot" aria-hidden="true"></span><span class="glove-chip-txt"></span>';
    chipTxt = chip.querySelector('.glove-chip-txt');
    hintEl = opts.hint || null;
    hintLang = opts.lang || null;
    if (hintEl) hintEl.addEventListener('click', hideHint);
    chip.addEventListener('click', function () {
      var s = chipStateNow();
      if (s === 'disconnected') {
        var g = G();
        if (g && g.connect) {
          g.connect().then(function (ok) {
            render();
            if (ok && G().ready()) {
              setOn(true);
              if (hintArmed) { hintArmed = false; showHint(); }
            }
          });
        }
        return;
      }
      if (s === 'connecting') return;
      if (s === 'nocal') {
        if (hintEl) {
          hintEl.innerHTML = hintLang && hintLang() === 'en'
            ? 'Glove connected but needs calibration. Please visit Admin Settings.'
            : 'Naka-connect ang glove pero kailangan i-calibrate sa Admin Settings.';
          hintEl.hidden = false;
          clearTimeout(hintTimer);
          hintTimer = setTimeout(hideHint, HINT_MS);
        }
        return;
      }
      setOn(!on);
      if (on && hintArmed) { hintArmed = false; showHint(); }
    });
    var g = G();
    if (g) {
      g.on('status', render);
      g.on('config', render);
      g.on('data', track);
    }
    render();
  }

  window.GloveAssist = {
    init: init,
    initChip: initChip,
    apply: apply,
    isOn: function () { return on; },
    setOn: setOn,
    reset: reset,
    startTurn: startTurn,
    chipState: function () { return chipState; },
    lastInfo: function () { return lastInfo; },
    barsWanted: barsWanted,
    setBarsWanted: function (v) { setBarsWanted(v); render(); },
    _setHands: function (hs) { lastHands = hs; }   // tests: the handedness of the "current frame"
  };
})();
