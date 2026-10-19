// js/sign-audio.js
// Speaks a signed message in Let's Talk (talk-turns-audio phase, docs/superpowers/specs/
// 2026-10-19-talk-turns-audio-design.md section 2): the signs play in order, each with its own
// recorded audio for the language (saved_gestures/<key>/audio_en.<ext> / audio_fil.<ext>, listed by
// php/api/signs.php `audio`). Signs without a recording are read by the browser voice
// (speechSynthesis), consecutive ones as one utterance so they sound like one phrase; with no voice
// at all they are skipped silently. Only one message plays at a time: play() stops the previous one.
(function () {
  'use strict';

  var VOICE_WAIT_MS = 400;   // getVoices() can be empty until the first voiceschanged
  var token = 0;
  var current = null;        // { token, abort, onEnd } of the message playing

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

  function pickVoice(list, lang) {
    var want = lang === 'fil' ? ['fil', 'tl'] : ['en-us', 'en'];
    for (var i = 0; i < want.length; i++) {
      for (var j = 0; j < list.length; j++) {
        if (String(list[j].lang || '').toLowerCase().indexOf(want[i]) === 0) return list[j];
      }
    }
    return null;   // the browser's default voice reads it
  }

  function speak(text, lang, myToken) {
    return voices().then(function (list) {
      if (myToken !== token || !list.length) return;   // no voice at all: skipped silently
      return new Promise(function (resolve) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang === 'fil' ? 'fil-PH' : 'en-US';
        u.rate = 0.9;
        var v = pickVoice(list, lang);
        if (v) u.voice = v;
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
      if (current && current.token === myToken) current.abort = function () { try { audio.pause(); } catch (e) { /* not playing */ } done(false); };
      audio.onended = function () { done(true); };
      audio.onerror = function () { done(false); };
      var p = audio.play();
      if (p && p.catch) p.catch(function () { done(false); });
    });
  }

  // Plays the message; resolves when it has finished or was stopped. opts.onEnd runs either way.
  function play(items, lang, audio, opts) {
    stop();
    opts = opts || {};
    var myToken = ++token;
    current = { token: myToken, abort: null, onEnd: opts.onEnd || null };
    var segs = segments(items, lang, audio);
    var chain = Promise.resolve();
    segs.forEach(function (seg) {
      chain = chain.then(function () {
        if (myToken !== token) return;
        if (seg.type === 'voice') return speak(seg.text, lang, myToken);
        return playUrl(seg.url, myToken).then(function (ok) {
          // A recording that cannot be played is read by the voice instead.
          if (!ok && myToken === token && seg.text) return speak(seg.text, lang, myToken);
        });
      });
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
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (c && c.onEnd) c.onEnd();
  }

  function isPlaying() { return current !== null; }

  window.SignAudio = { play: play, stop: stop, isPlaying: isPlaying, segments: segments };
})();
