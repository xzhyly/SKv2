// js/sign-audio.js
// Speaks a signed message in Let's Talk (talk-turns-audio phase, docs/superpowers/specs/
// 2026-10-19-talk-turns-audio-design.md section 2): the signs play in order, each with its own
// recorded audio for the language (saved_gestures/<key>/audio_en.<ext> / audio_fil.<ext>, listed by
// php/api/signs.php `audio`). Signs without a recording are read by the browser voice
// (speechSynthesis), consecutive ones as one utterance so they sound like one phrase; with no voice
// at all they are skipped silently. Only one message plays at a time: play() stops the previous one.
// Gapless playback (2026-10-19, owner ask): before a message plays, all of its recordings are fetched
// and decoded in parallel (Web Audio API: one shared AudioContext, decodeAudioData, decoded buffers
// cached per URL for the page lifetime, only the clips of the message being played). Each run of
// consecutive recordings is scheduled back to back on the AudioContext timeline, GAP_S apart, each
// with a FADE_S gain fade in/out, so the message sounds like one sentence instead of separate clips
// with a load wait between them. A word without a recording ends the run: the clips before it play,
// the voice reads it, then the next run is scheduled. A clip that cannot be decoded plays through the
// earlier <audio> path (and, failing that, the voice). Without Web Audio (or while the context cannot
// run) every clip takes the <audio> path. The context is resumed on the first tap (autoplay rule).
(function () {
  'use strict';

  var VOICE_WAIT_MS = 400;   // getVoices() can be empty until the first voiceschanged
  var GAP_S = 0.03;          // silence between two scheduled recordings (owner: 30 ms; was 70 ms)
  var FADE_S = 0.015;        // gain fade in and out at each recording's edges (no clicks)
  var LEAD_S = 0.03;         // a run starts this far ahead of currentTime, so its first clip is not late
  var RESUME_WAIT_MS = 300;  // play() waits this long for a suspended context before using <audio>
  var token = 0;
  var current = null;        // { token, abort, wait, nodes, onEnd } of the message playing

  // ── Web Audio: one shared context, decoded buffers per URL ──
  var AC = window.AudioContext || window.webkitAudioContext || null;
  var ctx = null;
  var buffers = new Map();   // url -> Promise<AudioBuffer|null> (null: not decodable, use <audio>)

  function getContext() {
    if (!ctx && AC) {
      try { ctx = new AC(); } catch (e) { console.warn('[sign-audio] no AudioContext:', e); AC = null; }
    }
    return ctx;
  }
  // Kiosk autoplay rule: the context is created and resumed inside the first tap (and any later one,
  // should the browser have suspended it).
  function unlock() {
    var c = getContext();
    if (c && c.state === 'suspended') c.resume().catch(function () { /* stays on <audio> */ });
  }
  if (AC && typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }
  // -> Promise<boolean>: whether scheduled playback can run now.
  function contextReady() {
    var c = getContext();
    if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    return Promise.race([
      c.resume().catch(function () {}),
      new Promise(function (r) { setTimeout(r, RESUME_WAIT_MS); })
    ]).then(function () { return c.state === 'running'; });
  }

  function loadBuffer(url) {
    if (buffers.has(url)) return buffers.get(url);
    var p = fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (data) {
      return ctx.decodeAudioData(data).catch(function (e) {
        console.warn('[sign-audio] cannot decode ' + url + ', playing it as <audio>:', e && e.message ? e.message : e);
        return null;                     // kept: never decoded again this page load
      });
    }, function (e) {
      buffers.delete(url);               // a failed fetch is not cached (it may work next time)
      console.warn('[sign-audio] cannot fetch ' + url + ':', e && e.message ? e.message : e);
      return null;
    });
    buffers.set(url, p);
    return p;
  }

  // Schedules decoded clips back to back and resolves when the last one has ended (or stop()).
  function playRun(c, run, myToken) {
    return new Promise(function (resolve) {
      var nodes = [];
      var t = c.currentTime + LEAD_S;
      var settled = false;
      var timer = null;
      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current && current.token === myToken) { current.wait = null; current.nodes = []; }
        nodes.forEach(function (n) { try { n.gain.disconnect(); } catch (e) { /* gone */ } });
        resolve();
      }
      run.forEach(function (seg) {
        var b = seg.buffer, d = b.duration, f = Math.min(FADE_S, d / 2);
        var src = c.createBufferSource();
        var gain = c.createGain();
        src.buffer = b;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + f);
        gain.gain.setValueAtTime(1, t + d - f);
        gain.gain.linearRampToValueAtTime(0, t + d);
        src.connect(gain);
        gain.connect(c.destination);
        src.start(t);
        nodes.push({ src: src, gain: gain });
        t += d + GAP_S;
      });
      nodes[nodes.length - 1].src.onended = done;
      // Safety net: onended does not fire while the context is suspended.
      timer = setTimeout(done, (t - c.currentTime) * 1000 + 1000);
      if (current && current.token === myToken) { current.wait = done; current.nodes = nodes; }
    });
  }

  // items: [{ key, text }] in sentence order; lang: 'en' | 'fil'; audio: key -> {en, fil} URLs.
  // -> [{ type: 'audio', url, text } | { type: 'voice', text }]
  function segments(items, lang, audio) {
    var out = [];
    (items || []).forEach(function (it) {
      var a = it && it.key && audio && audio[it.key];
      var url = a && (lang === 'fil' ? a.fil : a.en);
      var text = it && it.text ? String(it.text) : '';
      if (url) { out.push({ type: 'audio', url: url, text: text }); return; }
      if (!text) return;
      var last = out[out.length - 1];
      if (last && last.type === 'voice') last.text += ' ' + text;
      else out.push({ type: 'voice', text: text });
    });
    return out;
  }

  function voices() {
    var s = window.speechSynthesis;
    if (!s) return Promise.resolve([]);
    var list = s.getVoices();
    if (list.length) return Promise.resolve(list);
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        s.removeEventListener('voiceschanged', finish);
        resolve(s.getVoices());
      }
      s.addEventListener('voiceschanged', finish);
      setTimeout(finish, VOICE_WAIT_MS);
    });
  }

  function speak(text, lang, myToken) {
    return voices().then(function (list) {
      if (myToken !== token || !list.length) return;   // no voice at all: skipped silently
      return new Promise(function (resolve) {
        var u = new SpeechSynthesisUtterance(text);
        window.SKVoice.apply(u, lang);   // female voice, same rate / pitch / volume (js/sk-voice.js)
        var timer = setTimeout(resolve, 3000 + text.length * 150);   // onend never fires on some engines
        u.onend = u.onerror = function () { clearTimeout(timer); resolve(); };
        window.speechSynthesis.speak(u);
      });
    });
  }

  function playUrl(url, myToken) {
    return new Promise(function (resolve) {
      var audio = new Audio(url);
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        audio.onended = audio.onerror = null;
        resolve(ok);
      }
      // stop() pauses it, which fires no event: it settles the wait through abort() instead.
      // (This <audio> path is used for a clip Web Audio cannot decode, or when Web Audio is not available.)
      if (current && current.token === myToken) current.abort = function () { try { audio.pause(); } catch (e) { /* not playing */ } done(false); };
      audio.onended = function () { done(true); };
      audio.onerror = function () { done(false); };
      var p = audio.play();
      if (p && p.catch) p.catch(function () { done(false); });
    });
  }

  // One recording through <audio>; one that cannot be played is read by the voice instead.
  function playOne(seg, lang, myToken) {
    return playUrl(seg.url, myToken).then(function (ok) {
      if (!ok && myToken === token && seg.text) return speak(seg.text, lang, myToken);
    });
  }

  // segs -> steps in order: { run: [{url, text, buffer}] } (scheduled together) | { voice } | { single }.
  function steps(segs, decoded) {
    var out = [];
    segs.forEach(function (seg) {
      var b = seg.type === 'audio' ? decoded[seg.url] : null;
      if (b) {
        var last = out[out.length - 1];
        if (last && last.run) last.run.push({ url: seg.url, text: seg.text, buffer: b });
        else out.push({ run: [{ url: seg.url, text: seg.text, buffer: b }] });
      } else if (seg.type === 'audio') {
        out.push({ single: seg });
      } else {
        out.push({ voice: seg.text });
      }
    });
    return out;
  }

  // Plays the message; resolves when it has finished or was stopped. opts.onEnd runs either way.
  function play(items, lang, audio, opts) {
    stop();
    opts = opts || {};
    var myToken = ++token;
    current = { token: myToken, abort: null, wait: null, nodes: [], onEnd: opts.onEnd || null };
    var segs = segments(items, lang, audio);
    var urls = segs.filter(function (s) { return s.type === 'audio'; }).map(function (s) { return s.url; })
      .filter(function (u, i, a) { return a.indexOf(u) === i; });
    var decoded = {};
    // All clips of this message, fetched and decoded in parallel before the first one plays.
    var ready = !urls.length ? Promise.resolve(false) : contextReady().then(function (ok) {
      if (!ok) return false;
      return Promise.all(urls.map(function (u) {
        return loadBuffer(u).then(function (b) { decoded[u] = b; });
      })).then(function () { return true; });
    });
    var chain = ready.then(function (webAudio) {
      var list = webAudio ? steps(segs, decoded) : steps(segs, {});
      var c = getContext();
      return list.reduce(function (p, st) {
        return p.then(function () {
          if (myToken !== token) return;
          if (st.voice) return speak(st.voice, lang, myToken);
          if (st.single) return playOne(st.single, lang, myToken);
          return playRun(c, st.run, myToken);
        });
      }, Promise.resolve());
    });
    return chain.catch(function (e) { console.warn('[sign-audio] playback failed:', e); }).then(function () {
      if (myToken !== token) return;
      var c = current;
      current = null;
      if (c && c.onEnd) c.onEnd();
    });
  }

  function stop() {
    token++;
    var c = current;
    current = null;
    if (c && c.abort) c.abort();
    // every scheduled recording stops at once, played or not yet started
    if (c && c.nodes) c.nodes.forEach(function (n) { try { n.src.onended = null; n.src.stop(); } catch (e) { /* not started */ } });
    if (c && c.wait) c.wait();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (c && c.onEnd) c.onEnd();
  }

  function isPlaying() { return current !== null; }

  window.SignAudio = { play: play, stop: stop, isPlaying: isPlaying, segments: segments };
})();
