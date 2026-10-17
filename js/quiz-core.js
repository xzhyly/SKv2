// js/quiz-core.js
// Quiz questions and scoring (accounts-quiz phase, 2026-10-18). Pure: no DOM, no fetch.
// Attaches window.QuizCore, and module.exports under node (tests/accounts-quiz/quiz-core.test.mjs).
//
// A sign is {key, text, category, clip} as php/api/quiz.php ?action=pool returns it.
//   poolFor(signs, category)   -> the signs a quiz may use: that category ('mixed' = all), at most one
//                                 sign per text and per clip, so two choices never look the same
//   buildQuiz(pool, opts)      -> {ok:true, questions:[{seq, sign, choices:[4 signs], answer}]}
//                                 or {ok:false, reason:'too-few', count} when fewer than 4 signs
//   answerRecord(q, chosenKey, mode, atMs) -> one quiz_answers row as php/api/quiz.php saves it
//   score(records)             -> {correct, total}
(function () {
  'use strict';

  var CHOICES = 4;
  var CATEGORIES = ['letters', 'numbers', 'words', 'phrases', 'mixed'];
  var MODES = { 'sign-to-text': 'video_to_text', 'text-to-sign': 'text_to_video' };

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function textKey(text) { return String(text || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function clipKey(clip) { return clip ? (clip.type === 'avatar' ? 'avatar:' + clip.key : 'video:' + clip.src) : ''; }

  function poolFor(signs, category) {
    var seenText = {};
    var seenClip = {};
    var out = [];
    (signs || []).forEach(function (s) {
      if (!s || !s.key || !s.clip) return;
      if (category !== 'mixed' && s.category !== category) return;
      var t = textKey(s.text);
      var c = clipKey(s.clip);
      if (!t || seenText[t] || seenClip[c]) return;
      seenText[t] = true;
      seenClip[c] = true;
      out.push(s);
    });
    return out;
  }

  // The answer order: every sign once (shuffled) before any sign comes again, never the same sign
  // twice in a row. With 10 or more signs no sign repeats.
  function questionSigns(pool, count, rng) {
    var out = [];
    while (out.length < count) {
      var round = shuffle(pool, rng);
      if (out.length && round.length > 1 && round[0].key === out[out.length - 1].key) {
        round.push(round.shift());
      }
      for (var i = 0; i < round.length && out.length < count; i++) out.push(round[i]);
    }
    return out;
  }

  // 3 wrong choices: from the answer's own category first (always so for a single-category quiz),
  // then, for "All" when that category is too small, from the rest of the pool.
  function wrongChoices(pool, answer, rng) {
    var same = [];
    var other = [];
    pool.forEach(function (s) {
      if (s.key === answer.key) return;
      (s.category === answer.category ? same : other).push(s);
    });
    var picked = shuffle(same, rng).slice(0, CHOICES - 1);
    if (picked.length < CHOICES - 1) picked = picked.concat(shuffle(other, rng).slice(0, CHOICES - 1 - picked.length));
    return picked;
  }

  function buildQuiz(pool, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var count = opts.count || 10;
    if (!pool || pool.length < CHOICES) return { ok: false, reason: 'too-few', count: pool ? pool.length : 0 };
    var questions = questionSigns(pool, count, rng).map(function (sign, i) {
      var choices = shuffle([sign].concat(wrongChoices(pool, sign, rng)), rng);
      return { seq: i + 1, sign: sign, choices: choices, answer: choices.indexOf(sign) };
    });
    return { ok: true, questions: questions, repeats: pool.length < count };
  }

  function answerRecord(q, chosenKey, mode, atMs) {
    return {
      seq: q.seq,
      question_type: MODES[mode] || 'video_to_text',
      sign_key: q.sign.key,
      choices: q.choices.map(function (c) { return c.key; }),
      chosen_key: chosenKey == null ? null : chosenKey,
      is_correct: chosenKey === q.sign.key,
      answered_at_ms: atMs
    };
  }

  function score(records) {
    var correct = 0;
    (records || []).forEach(function (r) { if (r.chosen_key === r.sign_key) correct++; });
    return { correct: correct, total: (records || []).length };
  }

  // Small seeded generator (mulberry32) for repeatable tests.
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var api = {
    CHOICES: CHOICES,
    CATEGORIES: CATEGORIES,
    MODES: MODES,
    poolFor: poolFor,
    buildQuiz: buildQuiz,
    answerRecord: answerRecord,
    score: score,
    seeded: seeded
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.QuizCore = api;
})();
