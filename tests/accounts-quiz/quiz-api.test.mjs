// php/api/quiz.php (accounts-quiz phase): the sign pool (signs with an avatar clip in a language;
// avatar only since the talk-turns-audio phase), saving an attempt (logged-in only, scored server-side) and the
// scores (own for a user, everyone's or one user's for an admin).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callPhp, makeUser, cleanupAccounts, adminCookie, query, exec } from './helper.mjs';
import { repo } from '../conversations/helper.mjs';

const AV_DIR = path.join(repo, 'saved_gestures', 'zz_quiz_avatar');

function cleanupSigns() {
  exec(`DELETE FROM gestures WHERE label LIKE 'zz\\_quiz\\_%'`);
  fs.rmSync(AV_DIR, { recursive: true, force: true });
}
before(() => { cleanupAccounts(); cleanupSigns(); });
after(() => { cleanupAccounts(); cleanupSigns(); });

const pool = (lang) => callPhp({ script: 'quiz.php', method: 'GET', query: `action=pool&lang=${lang}` });
const save = (body, cookie) => callPhp({ script: 'quiz.php', body: { action: 'save', ...body }, cookie });
const scores = (q, cookie) => callPhp({ script: 'quiz.php', method: 'GET', query: 'action=scores&' + q, cookie });

test('pool: avatar clips only (talk-turns-audio: no video fallback); inactive and clip-less signs are out', () => {
  exec(`INSERT INTO gestures (label, sign_language, text_en, text_fil, category) VALUES
        ('zz_quiz_hello', 'BOTH', 'Hello', 'Kamusta', 'word'),
        ('zz_quiz_noclip', 'ESL', 'Zz no clip here', NULL, 'word'),
        ('zz_quiz_avatar', 'ESL', 'Zz avatar sign', NULL, 'phrase'),
        ('zz_quiz_off', 'ESL', 'Hello', NULL, 'word')`);
  exec(`UPDATE gestures SET is_active = 0 WHERE label = 'zz_quiz_off'`);
  fs.mkdirSync(AV_DIR, { recursive: true });
  fs.writeFileSync(path.join(AV_DIR, 'avatar.json'), '{}');

  const esl = pool('ESL');
  assert.equal(esl.status, 200);
  const byKey = Object.fromEntries(esl.json.signs.map((s) => [s.key, s]));
  // zz_quiz_hello's text matches assets/signs/en/hello.webm, which made it a quiz sign before this phase.
  assert.equal(byKey.zz_quiz_hello, undefined, 'a sign with only a video is not in the pool');
  assert.equal(byKey.zz_quiz_noclip, undefined);
  assert.equal(byKey.zz_quiz_off, undefined, 'inactive signs are left out');
  assert.deepEqual(byKey.zz_quiz_avatar, { key: 'zz_quiz_avatar', text: 'Zz avatar sign', category: 'phrases', clip: { type: 'avatar', key: 'zz_quiz_avatar' } });
  assert.ok(esl.json.signs.every((s) => s.clip.type === 'avatar'), 'every clip is an avatar clip');

  const fsl = pool('FSL').json.signs;
  assert.equal(fsl.find((s) => s.key === 'zz_quiz_hello'), undefined);
  assert.equal(fsl.find((s) => s.key === 'zz_quiz_avatar'), undefined, 'an ESL sign is not in the FSL pool');
  assert.ok(fsl.every((s) => s.clip.type === 'avatar'));
  assert.equal(pool('XX').status, 400);
});

function answers(n, correct, type = 'video_to_text') {
  return Array.from({ length: n }, (_, i) => {
    const choices = [`zz_k${i}a`, `zz_k${i}b`, `zz_k${i}c`, `zz_k${i}d`];
    return { seq: i + 1, question_type: type, sign_key: choices[1], choices, chosen_key: i < correct ? choices[1] : choices[2], is_correct: true };
  });
}

test('save: a guest is never saved (403)', () => {
  const before_ = Number(query('SELECT COUNT(*) AS n FROM quiz_attempts')[0].n);
  const r = save({ sign_language: 'FSL', category: 'words', answers: answers(10, 5) }, '');
  assert.equal(r.status, 403);
  assert.equal(Number(query('SELECT COUNT(*) AS n FROM quiz_attempts')[0].n), before_);
});

test('save: attempt + 10 answers; correctness and totals worked out by the server', () => {
  const u = makeUser();
  const startedAt = Date.now() - 60000;
  const r = save({ sign_language: 'FSL', category: 'mixed', started_at_ms: startedAt, answers: answers(10, 7, 'text_to_video') }, u.cookie);
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual([r.json.correct_items, r.json.total_items], [7, 10]);
  const a = query(`SELECT * FROM quiz_attempts WHERE id = ${r.json.attempt_id}`)[0];
  assert.equal(a.user_id, String(u.id));
  assert.equal(a.sign_language, 'FSL');
  assert.equal(a.category, 'mixed');
  assert.equal(a.total_items, '10');
  assert.equal(a.correct_items, '7');
  assert.notEqual(a.finished_at, null);
  const rows = query(`SELECT * FROM quiz_answers WHERE attempt_id = ${r.json.attempt_id} ORDER BY seq`);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].question_type, 'text_to_video');
  assert.deepEqual(JSON.parse(rows[0].choices), ['zz_k0a', 'zz_k0b', 'zz_k0c', 'zz_k0d']);
  assert.equal(rows.filter((x) => x.is_correct === '1').length, 7);
  assert.equal(rows[9].chosen_key, 'zz_k9c');
});

test('save: bad input is refused', () => {
  const u = makeUser();
  const bad = [
    { sign_language: 'XSL', category: 'words', answers: answers(1, 1) },
    { sign_language: 'ESL', category: 'colours', answers: answers(1, 1) },
    { sign_language: 'ESL', category: 'words', answers: [] },
    { sign_language: 'ESL', category: 'words', answers: [{ ...answers(1, 1)[0], choices: ['a', 'a', 'b', 'c'] }] },
    { sign_language: 'ESL', category: 'words', answers: [{ ...answers(1, 1)[0], sign_key: 'not_a_choice' }] },
    { sign_language: 'ESL', category: 'words', answers: [{ ...answers(1, 1)[0], chosen_key: 'not_a_choice' }] },
    { sign_language: 'ESL', category: 'words', answers: [{ ...answers(1, 1)[0], question_type: 'guess' }] },
  ];
  for (const b of bad) assert.equal(save(b, u.cookie).status, 400, JSON.stringify(b).slice(0, 120));
});

test('scores: a user sees their own count / average / best; an admin sees all and can filter', () => {
  const a = makeUser('Score A');
  const b = makeUser('Score B');
  assert.equal(save({ sign_language: 'ESL', category: 'letters', answers: answers(10, 7) }, a.cookie).status, 200);
  assert.equal(save({ sign_language: 'FSL', category: 'words', answers: answers(10, 10, 'text_to_video') }, a.cookie).status, 200);
  assert.equal(save({ sign_language: 'FSL', category: 'words', answers: answers(10, 2) }, b.cookie).status, 200);

  const mine = scores('', a.cookie).json;
  assert.deepEqual(mine.summary, { count: 2, average_pct: 85, best: { correct: 10, total: 10 } });
  assert.equal(mine.attempts.length, 2);
  assert.ok(mine.attempts.every((x) => x.user_id === a.id));
  assert.deepEqual(mine.attempts.map((x) => x.mode).sort(), ['text_to_video', 'video_to_text']);
  assert.equal(scores(`user=${b.id}`, a.cookie).json.attempts.every((x) => x.user_id === a.id), true, 'a user cannot look at another user');

  const adm = adminCookie();
  const all = scores('limit=100', adm).json;
  assert.ok(all.attempts.some((x) => x.user_id === a.id) && all.attempts.some((x) => x.user_id === b.id));
  const onlyB = scores(`user=${b.id}`, adm).json;
  assert.deepEqual(onlyB.summary, { count: 1, average_pct: 20, best: { correct: 2, total: 10 } });
  assert.equal(onlyB.attempts[0].username, b.username);

  const p = scores(`user=${a.id}&limit=1`, adm).json;
  assert.equal(p.attempts.length, 1);
  assert.equal(p.has_more, true);
});
