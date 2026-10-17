// js/quiz-core.js (accounts-quiz phase): pure, no server. 10 questions, 4 distinct choices with the
// answer among them, wrong choices from the answer's category, fewer than 4 signs -> no quiz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Q = require('../../js/quiz-core.js');

function sign(key, category, text = key, src = `assets/signs/en/${key}.webm`) {
  return { key, text, category, clip: { type: 'video', src } };
}
const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => sign(l, 'letters', l.toUpperCase()));
const words = ['hello', 'thanks', 'sorry', 'yes', 'no', 'help'].map((w) => sign(w, 'words'));

test('10 questions, each with 4 distinct choices that include the answer', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const r = Q.buildQuiz(Q.poolFor(letters, 'letters'), { count: 10, rng: Q.seeded(seed) });
    assert.equal(r.ok, true);
    assert.equal(r.questions.length, 10);
    assert.equal(new Set(r.questions.map((q) => q.sign.key)).size, 10, 'no repeated answer when the pool has 10+ signs');
    r.questions.forEach((q, i) => {
      assert.equal(q.seq, i + 1);
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices.map((c) => c.key)).size, 4);
      assert.equal(new Set(q.choices.map((c) => c.text)).size, 4);
      assert.equal(q.choices[q.answer].key, q.sign.key);
    });
  }
});

test('wrong choices come from the answer\'s category (also in an "All" quiz when it has 3 others)', () => {
  const pool = Q.poolFor(letters.concat(words), 'mixed');
  for (let seed = 1; seed <= 30; seed++) {
    const r = Q.buildQuiz(pool, { rng: Q.seeded(seed) });
    r.questions.forEach((q) => assert.ok(q.choices.every((c) => c.category === q.sign.category)));
  }
});

test('"All" with a category of fewer than 4 signs fills the choices from other categories', () => {
  const pool = Q.poolFor(letters.concat([sign('one', 'numbers'), sign('two', 'numbers')]), 'mixed');
  const r = Q.buildQuiz(pool, { count: 28, rng: Q.seeded(3) });
  const q = r.questions.find((x) => x.sign.category === 'numbers');
  assert.ok(q, 'a numbers question exists');
  assert.equal(new Set(q.choices.map((c) => c.key)).size, 4);
});

test('fewer than 4 signs: no quiz, a reason, no crash', () => {
  assert.deepEqual(Q.buildQuiz(Q.poolFor(words.slice(0, 3), 'words')), { ok: false, reason: 'too-few', count: 3 });
  assert.deepEqual(Q.buildQuiz(Q.poolFor([], 'numbers')), { ok: false, reason: 'too-few', count: 0 });
  assert.deepEqual(Q.buildQuiz(Q.poolFor(letters, 'numbers')), { ok: false, reason: 'too-few', count: 0 });
});

test('4 to 9 signs: still 10 questions; every sign before any repeat, never twice in a row', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const r = Q.buildQuiz(Q.poolFor(words, 'words'), { count: 10, rng: Q.seeded(seed) });
    assert.equal(r.questions.length, 10);
    assert.equal(r.repeats, true);
    assert.equal(new Set(r.questions.slice(0, 6).map((q) => q.sign.key)).size, 6);
    for (let i = 1; i < 10; i++) assert.notEqual(r.questions[i].sign.key, r.questions[i - 1].sign.key);
  }
});

test('poolFor keeps one sign per text and per clip, so two choices never look the same', () => {
  const dupes = [sign('a', 'letters', 'A'), sign('a2', 'letters', 'a '), sign('b', 'letters', 'B', 'assets/signs/en/a.webm'), sign('c', 'letters', 'C')];
  assert.deepEqual(Q.poolFor(dupes, 'letters').map((s) => s.key), ['a', 'c']);
  assert.deepEqual(Q.poolFor([{ key: 'x', text: 'X', category: 'letters', clip: null }], 'letters'), []);
});

test('answerRecord / score: the rows php/api/quiz.php saves', () => {
  const r = Q.buildQuiz(Q.poolFor(letters, 'letters'), { rng: Q.seeded(9) });
  const q = r.questions[0];
  const q2 = r.questions[1];
  const wrong = q2.choices[(q2.answer + 1) % 4].key;
  const rec1 = Q.answerRecord(q, q.sign.key, 'sign-to-text', 1000);
  const rec2 = Q.answerRecord(q2, wrong, 'text-to-sign', 2000);
  assert.deepEqual(Object.keys(rec1).sort(), ['answered_at_ms', 'choices', 'chosen_key', 'is_correct', 'question_type', 'seq', 'sign_key']);
  assert.equal(rec1.question_type, 'video_to_text');
  assert.equal(rec2.question_type, 'text_to_video');
  assert.deepEqual(rec1.choices, q.choices.map((c) => c.key));
  assert.equal(rec1.is_correct, true);
  assert.deepEqual(Q.score([rec1, rec2]), { correct: 1, total: 2 });
});
