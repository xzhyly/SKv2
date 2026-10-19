// js/sign-player.js
// Let's Talk "Speak or Type" sign playback, avatar only (talk-turns-audio phase,
// docs/superpowers/specs/2026-10-19-talk-turns-audio-design.md section 4). Every sign shown to the
// signer comes from the 2D avatar (js/avatar-player.js):
//   - a word or phrase whose sign has avatar data (php/api/signs.php `avatar`, the clip is
//     saved_gestures/<key>/avatar.json) plays that sign;
//   - any other word is fingerspelled by the avatar with the letter signs a-z and the number signs
//     1-10 (a number 1-10 is one sign; other numbers are spelled digit by digit); a character with
//     no sign (no clip, or no sign at all, e.g. "0" or "ñ") is shown only in the caption.
// The whole sentence plays as one continuous movement on the avatar; a caption-only character is a
// short pause at rest. The caption shows the sentence with the current word (or letter) highlighted.
// Before this phase the player ported archive/script.js's video pipeline (a word -> .webm map,
// assets/signs/<lang>/<word>.webm probes, video fingerspelling, fallback.png); that path is gone:
// this file requests no video and no image.
(function () {
  'use strict';

  var CAPTION_ONLY_MS = 700;      // a character with no sign stays highlighted this long
  // Number signs: the sign whose key is the numeral ("3"), else the English word key ("three").
  var NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  // ── VERBATIM archive/script.js:944-950 ──
function normalizeSpeechText(text) {
    return String(text)
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~'()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

  // ── VERBATIM archive/script.js:357-413 ──
function formatGrammar(text) {
    if (!text) return "";
    
    // Trim and clean spacing
    let formatted = text.trim().replace(/\s+/g, ' ');
    if (formatted.length === 0) return "";
    
    // Split sentences by '.', '?', '!' followed by space or end of string
    const parts = formatted.split(/([.?!]\s*)/);
    let result = "";
    const questionWords = [
        "who", "what", "where", "when", "why", "how", "which", "whose", "whom",
        "is", "are", "do", "does", "did", "can", "could", "should", "would", "will", "shall", "has", "have", "am", "was", "were"
    ];
    
    for (let i = 0; i < parts.length; i += 2) {
        let sentence = parts[i];
        if (sentence) {
            sentence = sentence.trim();
            if (sentence.length > 0) {
                // Capitalize first letter of sentence
                sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
                
                // Capitalize standalone "i"
                sentence = sentence.replace(/\bi\b/g, 'I');
                
                // Fix common contractions
                sentence = sentence
                    .replace(/\bim\b/g, "I'm").replace(/\bIm\b/g, "I'm")
                    .replace(/\bdont\b/g, "don't").replace(/\bDont\b/g, "Don't")
                    .replace(/\bcant\b/g, "can't").replace(/\bCant\b/g, "Can't")
                    .replace(/\bwont\b/g, "won't").replace(/\bWont\b/g, "Won't")
                    .replace(/\byoure\b/g, "you're").replace(/\bYoure\b/g, "You're");
                
                // Check if delimiter follows
                const delimiter = parts[i + 1] ? parts[i + 1].trim() : "";
                if (delimiter) {
                    sentence += delimiter + " ";
                } else {
                    // No delimiter - add smart ending punctuation
                    const lastChar = sentence.slice(-1);
                    const hasPunctuation = ['.', '?', '!'].includes(lastChar);
                    if (!hasPunctuation) {
                        const firstWord = sentence.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
                        if (questionWords.includes(firstWord)) {
                            sentence += "?";
                        } else {
                            sentence += ".";
                        }
                    }
                }
            }
            result += sentence;
        }
    }
    return result.trim();
}

  // Normalized text / key / key with spaces -> sign key, per language, for signs with avatar data
  // only (a sign without it is fingerspelled). First registration wins.
  var avatarKeyMapEn = {};
  var avatarKeyMapFil = {};
  var knownPhrasesEn = [];
  var knownPhrasesFil = [];
  var avatarKeys = {};            // every sign key with avatar data, any set (letters and numbers)
  var signs = {};                 // php/api/signs.php `signs`, by key

  function rebuildKnownPhrases() {
    function multi(map) {
      return Object.keys(map).filter(function (k) { return k.indexOf(' ') !== -1; })
        .sort(function (a, b) { return b.split(' ').length - a.split(' ').length; });
    }
    knownPhrasesEn = multi(avatarKeyMapEn);
    knownPhrasesFil = multi(avatarKeyMapFil);
  }

  function isFilipino(lang) { return lang === 'fil-PH' || lang === 'fil'; }

  // signs.php GET -> the maps above. Texts are registered with and without "?" (speech never has it,
  // typed text may).
  var SIGNS_ENDPOINT = 'php/api/signs.php';
  async function fetchSigns() {
    try {
      var response = await fetch(SIGNS_ENDPOINT);
      if (!response.ok) return signs;
      var data = await response.json();
      if (!data || !data.success || !data.signs) return signs;
      Object.keys(data.signs).forEach(function (key) {
        var sign = data.signs[key] || {};
        signs[key] = sign;
        if (sign.avatar !== true) return;
        avatarKeys[key] = true;
        var set = String(sign.set || '').toUpperCase();
        var register = function (map, text) {
          var names = [key, key.replace(/_/g, ' ')];
          if (typeof text === 'string' && text) {
            var norm = normalizeSpeechText(text);
            names.unshift(norm, norm.replace(/[?¿]/g, '').replace(/\s+/g, ' ').trim());
          }
          names.forEach(function (name) { if (name && !map[name]) map[name] = key; });
        };
        if (set === 'ESL' || set === 'BOTH') register(avatarKeyMapEn, sign.textEn);
        if (set === 'FSL' || set === 'BOTH') register(avatarKeyMapFil, sign.textFil);
      });
      rebuildKnownPhrases();
    } catch (e) {
      console.warn('Failed to load the signs for text-to-sign:', e);
    }
    return signs;
  }
  var signsPromise = null;
  // One signs.php fetch per page load; resolves to the signs by key (also used by js/sign-audio.js).
  function registerCustomGestures() {
    if (!signsPromise) signsPromise = fetchSigns();
    return signsPromise;
  }

  function numberKey(n) {
    var names = [String(n), NUMBER_WORDS[n]];
    for (var i = 0; i < names.length; i++) if (names[i] && avatarKeys[names[i]]) return names[i];
    return null;
  }

  // One word without a sign -> its fingerspelling units. Punctuation is dropped; a letter or digit
  // with no sign stays as a caption-only unit (key null).
  function spell(word) {
    var units = [];
    Array.from(word).forEach(function (ch) {
      if (/[a-z]/.test(ch)) units.push({ key: avatarKeys[ch] ? ch : null, label: ch.toUpperCase() });
      else if (/[0-9]/.test(ch)) units.push({ key: numberKey(Number(ch)), label: ch });
      else if (/[\p{L}\p{N}]/u.test(ch)) units.push({ key: null, label: ch.toUpperCase() });
    });
    return units;
  }

  // Text -> [{ text, kind: 'sign' | 'spell', units: [{ key|null, label }] }] in sentence order.
  // Longest known phrase first (signs with avatar data only), then the single word, then a number
  // 1-10 as one sign, else fingerspelling.
  function plan(text, lang) {
    var fil = isFilipino(lang);
    var map = fil ? avatarKeyMapFil : avatarKeyMapEn;
    var phrases = fil ? knownPhrasesFil : knownPhrasesEn;
    var clean = normalizeSpeechText(text).replace(/[?¿]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    var words = clean.split(' ');
    // The caption shows the words as typed (case kept) when they line up one to one with `words`.
    var typed = String(text).replace(/[.,/#!$%^&*;:{}=\-_`~'()?¿]/g, '').replace(/\s+/g, ' ').trim().split(' ');
    var shown = typed.length === words.length ? typed : words;
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var matched = null;
      for (var p = 0; p < phrases.length && !matched; p++) {
        var n = phrases[p].split(' ').length;
        if (words.slice(i, i + n).join(' ') === phrases[p]) matched = { text: phrases[p], n: n };
      }
      if (matched) {
        out.push({ text: shown.slice(i, i + matched.n).join(' '), kind: 'sign', units: [{ key: map[matched.text], label: matched.text }] });
        i += matched.n - 1;
        continue;
      }
      var w = words[i];
      var num = /^[0-9]+$/.test(w) ? Number(w) : 0;
      var key = map[w] || (num >= 1 && num <= 10 ? numberKey(num) : null);
      if (key) { out.push({ text: shown[i], kind: 'sign', units: [{ key: key, label: w }] }); continue; }
      var units = spell(w);
      if (units.length) out.push({ text: shown[i], kind: 'spell', units: units });
    }
    return out;
  }

  // The caption: the sentence, one span per word, a fingerspelled word as letter boxes. -> setActive(w, u)
  function renderCaption(el, planned) {
    el.textContent = '';
    var sub = document.createElement('div');
    sub.className = 'cap-sub';
    var line = document.createElement('div');
    line.className = 'cap-line';
    var wordEls = planned.map(function (w, i) {
      if (i > 0) line.appendChild(document.createTextNode(' '));
      var span = document.createElement('span');
      if (w.kind === 'spell') {
        span.className = 'cap-spell';
        w.units.forEach(function (u) {
          var l = document.createElement('span');
          l.className = 'ltr' + (u.key ? '' : ' nosign');
          l.textContent = u.label;
          span.appendChild(l);
        });
      } else {
        span.className = 'cap-word';
        span.textContent = w.text;
      }
      line.appendChild(span);
      return span;
    });
    el.appendChild(sub);
    el.appendChild(line);
    var on = [];
    return function setActive(wi, ui) {
      on.forEach(function (x) { x.classList.remove('on'); });
      on = [];
      if (wi < 0 || !planned[wi]) { sub.textContent = ''; return; }
      var w = planned[wi];
      on.push(wordEls[wi]);
      if (w.kind === 'spell') {
        var l = wordEls[wi].children[ui];
        if (l) on.push(l);
        sub.textContent = 'Spelling “' + w.text + '” (no sign yet) · letter ' + (ui + 1) + ' of ' + w.units.length;
      } else {
        sub.textContent = planned.length > 1 ? 'Word ' + (wi + 1) + ' of ' + planned.length : '';
      }
      on.forEach(function (x) { x.classList.add('on'); });
    };
  }

  // opts: { caption: element, getLanguage() -> 'en-US' | 'fil-PH',
  //         avatar: { store (js/avatar-store.js), getPlayer() -> AvatarPlayer or null while the parts load } }
  function create(opts) {
    var caption = opts.caption;
    var getLanguage = opts.getLanguage;
    var avatar = opts.avatar || null;
    var token = 0;
    var playing = false;
    var aborts = [];

    function sleep(ms) {
      return new Promise(function (resolve) {
        var timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          aborts = aborts.filter(function (f) { return f !== done; });
          resolve();
        }
        aborts.push(done);
      });
    }
    function abortAll() {
      var list = aborts;
      aborts = [];
      list.forEach(function (fn) { fn(); });
    }

    async function playSequence(text, myToken) {
      await registerCustomGestures();
      if (myToken !== token) return;
      var planned = plan(text, getLanguage());
      var setActive = renderCaption(caption, planned);
      var flat = [];
      planned.forEach(function (w, wi) { w.units.forEach(function (u, ui) { flat.push({ w: wi, u: ui, key: u.key }); }); });
      var player = avatar && avatar.getPlayer();
      var preps = await Promise.all(flat.map(function (f) {
        return f.key && player ? avatar.store.load(f.key) : Promise.resolve(null);
      }));
      var i = 0;
      while (i < flat.length) {
        if (myToken !== token) return;
        if (!preps[i]) {
          setActive(flat[i].w, flat[i].u);
          await sleep(CAPTION_ONLY_MS);
          i++;
          continue;
        }
        var j = i;
        while (j < flat.length && preps[j]) j++;
        var run = flat.slice(i, j);
        await player.play(preps.slice(i, j), {
          onWord: function (k) { if (myToken === token && run[k]) setActive(run[k].w, run[k].u); }
        });
        i = j;
      }
      if (myToken === token) setActive(-1);
    }

    function play(text) {
      abortAll();                       // a new play() supersedes any sequence still running
      var p = avatar && avatar.getPlayer();
      if (p) p.cancel();
      var myToken = ++token;
      playing = true;
      return playSequence(text, myToken).finally(function () {
        if (myToken === token) playing = false;
      });
    }

    function cancel() {
      token++;
      playing = false;
      abortAll();
      var p = avatar && avatar.getPlayer();
      if (p) p.cancel();
      caption.textContent = '';
    }

    function isPlaying() { return playing; }

    return { play: play, cancel: cancel, isPlaying: isPlaying };
  }

  window.SignPlayer = {
    create: create,
    plan: plan,
    normalizeSpeechText: normalizeSpeechText,
    formatGrammar: formatGrammar,
    registerCustomGestures: registerCustomGestures
  };
})();
