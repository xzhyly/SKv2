// js/sk-voice.js
// The browser-voice fallback (speechSynthesis) speaks with a female voice, to match the female recorded
// sign audio. Used by js/sign-audio.js (Let's Talk) and js/speech-synthesis.js (Train Gestures).
// Per language (en / fil): a voice for that language whose name is a known female voice, never a male
// one; Filipino with no female fil/tl voice -> the English female voice; no female voice at all -> the
// browser's default voice with a raised pitch. The choice is cached per language and recomputed when the
// voice list changes (voiceschanged). Every fallback word gets the same rate / pitch / volume.
(function () {
  'use strict';

  var RATE = 0.9;
  var PITCH = 1;
  var PITCH_NO_FEMALE = 1.25;
  var FEMALE = /zira|aria|jenny|hazel|susan|samantha|karen|moira|tessa|victoria|blessica|\bfemale\b|\+f[1-5]\b/i;
  var MALE = /david|mark|guy|george|angelo|daniel|alex|\bmale\b/i;
  var cache = {};    // lang -> { voice|null, pitch }
  var logged = {};   // lang -> the voice name already logged

  function langOf(lang) { return lang === 'fil' || lang === 'fil-PH' ? 'fil' : 'en'; }

  function female(list, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      for (var j = 0; j < list.length; j++) {
        var v = list[j];
        var code = String(v.lang || '').toLowerCase().replace('_', '-');
        var name = String(v.name || '');
        if (code.indexOf(prefixes[i]) === 0 && FEMALE.test(name) && !MALE.test(name)) return v;
      }
    }
    return null;
  }

  // lang 'en' | 'fil' (or 'fil-PH') -> { voice: SpeechSynthesisVoice|null, pitch }
  function pick(lang) {
    var key = langOf(lang);
    if (cache[key]) return cache[key];
    var s = window.speechSynthesis;
    var list = s ? s.getVoices() : [];
    var en = female(list, ['en-us', 'en']);
    var v = key === 'fil' ? (female(list, ['fil', 'tl']) || en) : en;
    var choice = { voice: v, pitch: v ? PITCH : PITCH_NO_FEMALE };
    if (list.length) cache[key] = choice;   // an empty list is not final (voices still loading)
    var label = v ? v.name + ' (' + v.lang + ')' : 'browser default, pitch ' + PITCH_NO_FEMALE;
    if (list.length && logged[key] !== label) {
      logged[key] = label;
      console.info('Fallback voice for ' + key + ': ' + label);
    }
    return choice;
  }

  function volume() {
    var stored = null;
    try { stored = localStorage.getItem('sining_kamay_speaker_volume'); } catch (e) { /* no storage */ }
    var n = parseFloat(stored || '1.0');
    return isFinite(n) ? n : 1;
  }

  // Sets voice, lang, rate, pitch and volume on an utterance for the language.
  function apply(u, lang) {
    var key = langOf(lang);
    var c = pick(key);
    u.lang = c.voice ? c.voice.lang : (key === 'fil' ? 'fil-PH' : 'en-US');
    if (c.voice) u.voice = c.voice;
    u.rate = RATE;
    u.pitch = c.pitch;
    u.volume = volume();
    return u;
  }

  if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener('voiceschanged', function () { cache = {}; });
  }

  window.SKVoice = { pick: pick, apply: apply };
})();
