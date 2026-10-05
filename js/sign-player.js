// js/sign-player.js
// DOM-agnostic port of archive/script.js's text-to-sign pipeline for talk.html's Speak-or-Type
// preview (docs/superpowers/specs/2026-09-21-text-to-sign-merge-design.md). archive/script.js
// cannot be loaded into talk.html (it dereferences index.html-only ids at load, script.js:13
// and :441), and it was retired (archived) together with index.html's #translator-pane, so this is a port of a copy, not a
// shared module. Sections marked VERBATIM are unchanged from archive/script.js (line ranges given);
// the only departures are listed in docs/superpowers/plans/2026-09-21-text-to-sign-merge.md.
// Two further departures from the VERBATIM sections (sign-texts phase, one sign / two texts):
//  1. fetchAndRegisterCustomGestures reads php/api/signs.php (not save_gesture.php) and registers
//     each sign's normalized English text (ESL/BOTH) and Filipino text (FSL/BOTH) in the matching
//     language map, valued by the sign's assetPath (else key.webm), plus the key as before.
//  2. displaySignWithFallback uses an asset-map value that starts with "assets/" as the path as-is,
//     instead of prefixing the language asset base.
// Avatar phase (docs/reports/2026-10-05-avatar-step1.md (a)): fetchAndRegisterCustomGestures also
// fills a text -> sign-key map per language for signs that have an avatar clip (signs.php `avatar`),
// and playSequence() plays each run of consecutive items that have a clip on the avatar as one
// continuous movement (opts.avatar, js/avatar-player.js). Every other item still goes through the
// unchanged displaySignWithFallback chain (video, fingerspelling, fallback.png). Without opts.avatar
// the behaviour is exactly the previous one.
(function () {
  'use strict';

  // ── VERBATIM archive/script.js:19-141 ──
const signAssetMapEn = {
    "i dont know": "dont_know.webm",
    "dont know": "dont_know.webm",
    "i dont understand": "dont_understand.webm",
    "dont understand": "dont_understand.webm",
    "dont like": "dont_like.webm",
    "dont want": "dont_want.webm",
    "how are you": "how_are_you.webm",
    "how are you doing": "how_are_you.webm",
    "good morning": "good_morning.webm",
    "nice to meet you": "nice_to_meet_you.webm",
    "see you later": "see_you_later.webm",
    "where do you live": "where_do_you_live.webm",
    "where is the bathroom": "where_is_the_bathroom.webm",
    "what is your name": "what_is_your_name.webm",
    "what did you say": "what_did_you_say.webm",
    "do you understand": "do_you_understand.webm",
    "no i dont understand": "no_i_dont_understand.webm",
    "are you hearing": "are_you_hearing.webm",
    "my name": "my_name.webm",
    "please": "please.webm",
    "love": "love.webm",
    "happy": "happy.webm",
    "sad": "sad.webm",
    "morning": "morning.webm",
    "afternoon": "afternoon.webm",
    "night": "night.webm",
    "hello": "hello.webm",
    "goodbye": "goodbye.webm",
    "yes": "yes.webm",
    "no": "no.webm",
    "help": "help.webm",
    "thank you": "nice_to_meet_you.webm",
    "deaf": "deaf.webm",
    "hearing": "hearing.webm",
    "friend": "friend.webm",
    "family": "family.webm",
    "mother": "mother.webm",
    "father": "father.webm",
    "sister": "sister.webm",
    "brother": "brother.webm",
    "understand": "understand.webm",
    "name": "name.webm",
    "where": "where.webm",
    "what": "what.webm",
    "when": "when.webm",
    "who": "who.webm",
    "why": "why.webm",
    "how": "how.webm",
    "know": "know.webm",
    "want": "want.webm",
    "like": "like.webm",
    "good": "good.webm",
    "bad": "bad.webm",
    "more": "more.webm",
    "nothing": "nothing.webm",
    "come": "come.webm",
    "go": "go.webm",
    "work": "work.webm",
    "learn": "learn.webm",
    "student": "student.webm",
    "meet": "meet.webm",
    "see": "see.webm",
    "tired": "tired.webm",
    "sick": "sick.webm",
    "scared": "scared.webm",
    "confused": "confused.webm",
    "excited": "excited.webm",
    "bored": "bored.webm",
    "busy": "busy.webm",
    "nice": "nice.webm",
    "done": "done.webm",
    "home": "home.webm",
    "time": "time.webm",
    "day": "day.webm",
    "week": "week.webm",
    "month": "month.webm",
    "year": "year.webm"
};

const signAssetMapFil = {
    "kamusta": "kamusta.webm",
    "magandang umaga": "magandang_umaga.webm",
    "magandang hapon": "hapon.webm",
    "magandang gabi": "gabi.webm",
    "paalam": "paalam.webm",
    "asawa": "asawa.webm",
    "ama": "ama.webm",
    "ina": "ina.webm",
    "ate": "ate.webm",
    "kapatid": "kapatid_sa_pangasinan.webm",
    "mag-anak": "mag-anak.webm",
    "kailan": "kailan.webm",
    "saan": "saan.webm",
    "bakit": "bakit.webm",
    "sino": "sino.webm",
    "ano": "ano_ba_sabi_mo.webm",
    "kailangan": "kailangan.webm",
    "tulong": "tulong.webm",
    "salamat": "nice_to_meet_you.webm",
    "oo": "yes.webm",
    "hindi": "no.webm",
    "tapos": "tapos.webm",
    "bukas": "bukas.webm",
    "gabi": "gabi.webm",
    "umaga": "magandang_umaga.webm",
    "hapon": "hapon.webm",
    "mahal": "love.webm",
    "masaya": "happy.webm",
    "malungkot": "sad.webm",
    "sige": "go.webm",
    "punta": "go.webm",
    "linggo": "linggo.webm",
    "buwan": "buwan.webm",
    "taon": "taon.webm",
    "araw": "day.webm"
};

// Populate alphabet letters for both language maps
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    signAssetMapEn[letter] = `${letter}.webm`;
    signAssetMapFil[letter] = `${letter}.webm`;
}

  // ── VERBATIM archive/script.js:838-849 ──
let knownPhrasesEn = [];
let knownPhrasesFil = [];

function rebuildKnownPhrases() {
    knownPhrasesEn = Object.keys(signAssetMapEn)
        .filter((key) => key.includes(" "))
        .sort((a, b) => b.split(" ").length - a.split(" ").length);
    knownPhrasesFil = Object.keys(signAssetMapFil)
        .filter((key) => key.includes(" "))
        .sort((a, b) => b.split(" ").length - a.split(" ").length);
}
rebuildKnownPhrases();

  // archive/script.js:144-159 with the language passed in (script.js reads #lang-select).
  function isFilipino(lang) { return lang === 'fil-PH'; }
  function getSignAssetBase(lang) { return isFilipino(lang) ? 'assets/signs/fil/' : 'assets/signs/en/'; }
  function getActiveSignMap(lang) { return isFilipino(lang) ? signAssetMapFil : signAssetMapEn; }
  function getActiveKnownPhrases(lang) { return isFilipino(lang) ? knownPhrasesFil : knownPhrasesEn; }

  // ── VERBATIM archive/script.js:944-950 ──
function normalizeSpeechText(text) {
    return String(text)
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~'()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

  // archive/script.js:952-963, only change: the language is an argument.
  function findLongestKnownPhrase(words, startIndex, lang) {
    const phrases = getActiveKnownPhrases(lang);
    for (const phrase of phrases) {
      const phraseWords = phrase.split(" ");
      const candidate = words.slice(startIndex, startIndex + phraseWords.length).join(" ");
      if (candidate === phrase) {
        return { text: phrase, wordCount: phraseWords.length };
      }
    }

    return null;
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

  // Avatar phase: normalized text / key -> sign key, only for signs with an avatar clip.
  const avatarKeyMapEn = {};
  const avatarKeyMapFil = {};

  // archive/script.js:851-878, with the endpoint and the registration changed (departure 1 below).
  const SAVE_ENDPOINT = "php/api/signs.php";
async function fetchAndRegisterCustomGestures() {
    try {
        const response = await fetch(SAVE_ENDPOINT);
        if (!response.ok) return;
        const data = await response.json();
        if (data && data.success && data.signs) {
            Object.keys(data.signs).forEach(key => {
                const sign = data.signs[key] || {};
                const set = String(sign.set || '').toUpperCase();
                const inEn = set === 'ESL' || set === 'BOTH';
                const inFil = set === 'FSL' || set === 'BOTH';
                const value = (typeof sign.assetPath === 'string' && sign.assetPath) ? sign.assetPath : `${key}.webm`;
                const spaceKey = key.replace(/_/g, ' ');
                const register = (map, text) => {
                    const names = [key, spaceKey];
                    if (typeof text === 'string' && text) {
                        // normalizeSpeechText keeps "?"; speech never has it, typed text may. Register both.
                        const norm = normalizeSpeechText(text);
                        const bare = norm.replace(/[?¿]/g, '').replace(/\s+/g, ' ').trim();
                        if (bare && bare !== norm) names.unshift(bare);
                        names.unshift(norm);
                    }
                    names.forEach(name => { if (name && !map[name]) map[name] = value; });
                };
                if (inEn) register(signAssetMapEn, sign.textEn);
                if (inFil) register(signAssetMapFil, sign.textFil);
                if (sign.avatar === true) {
                    // same names as the asset maps, valued by the key (first registration wins)
                    const registerKey = (map, text) => {
                        const names = [key, spaceKey];
                        if (typeof text === 'string' && text) {
                            const norm = normalizeSpeechText(text);
                            names.unshift(norm, norm.replace(/[?¿]/g, '').replace(/\s+/g, ' ').trim());
                        }
                        names.forEach(name => { if (name && !map[name]) map[name] = key; });
                    };
                    if (inEn) registerKey(avatarKeyMapEn, sign.textEn);
                    if (inFil) registerKey(avatarKeyMapFil, sign.textFil);
                }
            });
            rebuildKnownPhrases();
        }
    } catch (e) {
        console.warn('Failed to load custom gestures for text-to-sign:', e);
    }
}
  let customGesturesPromise = null;
  function registerCustomGestures() {
    if (!customGesturesPromise) customGesturesPromise = fetchAndRegisterCustomGestures();
    return customGesturesPromise;
  }

  function create(opts) {
    const container = opts.container;
    const wordLabel = opts.wordLabel;
    const getLanguage = opts.getLanguage;
    // opts.avatar (optional): { store (js/avatar-store.js), getPlayer() -> AvatarPlayer or null while
    // the parts load, show(), hide() } -- show/hide swap the avatar canvas and the video container.
    const avatar = opts.avatar || null;
    let token = 0;
    let playing = false;
    let aborts = [];   // each settles whatever the current step is waiting on

    function releaseVideo(v) {
      try { v.pause(); } catch (e) { /* not playing */ }
      v.removeAttribute('src');
      v.load();
    }
    function clearContainer() {
      const vids = container.querySelectorAll('video');
      for (let i = 0; i < vids.length; i++) releaseVideo(vids[i]);
      container.innerHTML = '';
    }
    function abortAll() {
      const list = aborts;
      aborts = [];
      list.forEach(function (fn) { fn(); });
    }
    function sleep(ms) {
      return new Promise(function (resolve) {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          aborts = aborts.filter(function (f) { return f !== done; });
          resolve();
        }
        aborts.push(done);
      });
    }

    // archive/script.js:965-1010
    function displayMedia(path, label, duration) {
      duration = duration || 0;
      return new Promise(function (resolve) {
        let settled = false;
        let video = null;
        let img = null;
        let timer = null;
        function finish(ok) {
          if (settled) return;
          settled = true;
          aborts = aborts.filter(function (f) { return f !== abort; });
          clearTimeout(timer);
          if (video) {
            video.onloadedmetadata = video.onended = video.onerror = null;
            if (!ok) releaseVideo(video);   // a clip that ended stays as the last frame until replaced
          }
          if (img) img.onload = img.onerror = null;
          resolve(ok);
        }
        function abort() { finish(false); }
        aborts.push(abort);

        // Handle video files (.webm, .mp4)
        if (/\.(webm|mp4)$/i.test(path)) {
          video = document.createElement('video');
          video.src = path;
          video.autoplay = true;
          video.muted = true;
          video.loop = false;
          video.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
          video.onloadedmetadata = function () {
            wordLabel.textContent = label.toUpperCase();
            clearContainer();
            container.appendChild(video);
            video.play().catch(function () {});
          };
          video.onended = function () { finish(true); };
          video.onerror = function () { finish(false); };
          video.load();
          return;
        }

        // Handle image files
        img = new Image();
        img.onload = function () {
          wordLabel.textContent = label.toUpperCase();
          clearContainer();
          img.alt = label;
          img.style.cssText = 'max-width:100%; max-height:100%; object-fit:contain;';
          container.appendChild(img);
          if (duration > 0) {
            timer = setTimeout(function () { finish(true); }, duration);
          } else {
            finish(true);
          }
        };
        img.onerror = function () { finish(false); };
        img.src = path;
      });
    }

    // archive/script.js:906-942
    async function displaySignWithFallback(item, myToken) {
      const lang = getLanguage();
      const normalizedItem = normalizeSpeechText(item);
      const assetBase = getSignAssetBase(lang);

      // 1. Check for a custom recorded .webm video in language-specific assets/signs/ folder
      const customVideoPath = assetBase + normalizedItem.replace(/\s+/g, '_') + '.webm';
      const hasCustomVideo = await new Promise(function (resolve) {
        const v = document.createElement('video');
        function done(ok) {
          v.onloadedmetadata = null;
          v.onerror = null;
          releaseVideo(v);
          resolve(ok);
        }
        v.onloadedmetadata = function () { done(true); };
        v.onerror = function () { done(false); };
        v.src = customVideoPath;
        v.load();
      });
      if (myToken !== token) return;
      if (hasCustomVideo) {
        await displayMedia(customVideoPath, item);
        return;
      }

      // 2. Fall back to language-specific static asset map
      const assetMap = getActiveSignMap(lang);
      const assetFile = assetMap[normalizedItem];
      const isSuccess = assetFile
        ? await displayMedia(assetFile.indexOf('assets/') === 0 ? assetFile : assetBase + assetFile, item)
        : false;
      if (myToken !== token) return;

      if (!isSuccess && normalizedItem.length > 1) {
        // Fingerspell letter by letter using .webm from the active language folder
        const letters = normalizedItem.replace(/\s/g, "").split("");
        for (const letter of letters) {
          if (myToken !== token) return;
          await displayMedia(assetBase + letter + '.webm', letter, 800);
        }
      } else if (!isSuccess) {
        await displayMedia(assetBase + 'fallback.png', item, 1200);
      } else {
        await sleep(2000);
      }
    }

    // Avatar phase: the sign key of an item that has an avatar clip, else null.
    function avatarKeyFor(item) {
      if (!avatar || !avatar.getPlayer() || !window.AvatarTimeline) return null;
      const map = isFilipino(getLanguage()) ? avatarKeyMapFil : avatarKeyMapEn;
      return map[normalizeSpeechText(item)] || null;
    }

    // Plays one run of items that have clips. A clip that fails to load plays its word as video.
    async function playAvatarRun(items, myToken) {
      const preps = await Promise.all(items.map(function (it) { return avatar.store.load(it.key); }));
      let i = 0;
      while (i < items.length) {
        if (myToken !== token) return;
        if (!preps[i]) {
          avatar.hide();
          await displaySignWithFallback(items[i].item, myToken);
          i++;
          continue;
        }
        let j = i;
        while (j < items.length && preps[j]) j++;
        const run = items.slice(i, j);
        clearContainer();
        avatar.show();
        await avatar.getPlayer().play(preps.slice(i, j), {
          onWord: function (k) { if (myToken === token && run[k]) wordLabel.textContent = run[k].item.toUpperCase(); }
        });
        i = j;
      }
    }

    // archive/script.js:881-904
    async function playSequence(text, myToken) {
      const cleanText = normalizeSpeechText(text);
      if (!cleanText) {
        return;
      }

      let words = cleanText.split(" ");
      let sequence = [];

      for (let i = 0; i < words.length; i++) {
        const phrase = findLongestKnownPhrase(words, i, getLanguage());
        if (phrase) {
          sequence.push(phrase.text);
          i += phrase.wordCount - 1;
          continue;
        }

        sequence.push(words[i]);
      }

      if (avatar && window.AvatarTimeline) {
        const runs = window.AvatarTimeline.splitRuns(sequence.map(function (item) { return { item: item, key: avatarKeyFor(item) }; }));
        for (const run of runs) {
          if (myToken !== token) return;
          if (run.type === 'avatar') {
            await playAvatarRun(run.items, myToken);
          } else {
            avatar.hide();
            await displaySignWithFallback(run.item, myToken);
          }
        }
        return;
      }

      for (const item of sequence) {
        if (myToken !== token) return;
        await displaySignWithFallback(item, myToken);
      }
    }

    function play(text) {
      abortAll();                       // a new play() supersedes any sequence still running
      if (avatar && avatar.getPlayer()) avatar.getPlayer().cancel();
      const myToken = ++token;
      playing = true;
      return playSequence(text, myToken).finally(function () {
        if (myToken === token) playing = false;
      });
    }

    function cancel() {
      token++;
      playing = false;
      abortAll();
      if (avatar) {
        const p = avatar.getPlayer();
        if (p) p.cancel();
        avatar.hide();
      }
      clearContainer();
      wordLabel.textContent = '';
    }

    function isPlaying() { return playing; }

    return { play: play, cancel: cancel, isPlaying: isPlaying };
  }

  window.SignPlayer = {
    create: create,
    normalizeSpeechText: normalizeSpeechText,
    formatGrammar: formatGrammar,
    registerCustomGestures: registerCustomGestures
  };
})();
