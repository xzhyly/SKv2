// php/api/avatar_clip.php (save / delete) and the signs.php `avatar` flag, under php-cgi against
// the live dataset with zz-prefixed probe signs only (tests/sign-texts/api-helper.mjs).
// A clip never touches the sign's samples or sign.json; the full sync ignores avatar.json;
// deleting the sign removes its clip with the folder (step 1 report Q3).
// Run (MariaDB up): node --test --test-concurrency=1 tests/avatar/avatar-clip-endpoint.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callApi, saveApi, signsApi, save, dir, samples, cleanZz, row } from '../sign-texts/api-helper.mjs';

before(cleanZz);
after(cleanZz);

const clipApi = (body, extra = {}) => callApi('avatar_clip.php', { body, ...extra });
const KEY = 'zz_avatar_probe';
const pose = () => Array.from({ length: 11 }, (_, i) => [0.5, 0.1 + i * 0.05, -0.1, 0.9]);
const hand = () => Array.from({ length: 21 }, (_, i) => [0.4 + i * 0.001, 0.6, 0]);
const clip = (n = 3, extra = {}) => ({
  format: 'sk_avatar_clip_v1', key: KEY, fps: 25, video: { w: 1080, h: 1920, durationMs: 4000 },
  trim: { startMs: 0, endMs: 80, auto: true }, extractor: { lib: '@mediapipe/holistic 0.5.1675471629', modelComplexity: 1 },
  signer: 'Probe', createdAt: 'x', poseIdx: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
  frames: Array.from({ length: n }, (_, i) => [pose(), i % 2 ? hand() : null, hand()]), ...extra,
});
const avatarFile = (key = KEY) => path.join(dir(key), 'avatar.json');
const snapshot = (key = KEY) => fs.readdirSync(dir(key)).filter((f) => f !== 'avatar.json').sort()
  .map((f) => [f, fs.readFileSync(path.join(dir(key), f), 'utf8')]);

test('save writes avatar.json for an existing sign and touches nothing else', () => {
  assert.equal(save({ sign_language: 'ESL', text_en: 'Zz Avatar Probe' }).status, 200);
  const before = snapshot();
  const r = clipApi({ action: 'save', key: KEY, clip: clip(5, { extra: 'dropped' }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.success, true);
  assert.equal(r.json.frames, 5);
  const stored = JSON.parse(fs.readFileSync(avatarFile(), 'utf8'));
  assert.equal(stored.format, 'sk_avatar_clip_v1');
  assert.equal(stored.frames.length, 5);
  assert.deepEqual(stored.frames[1][1], hand());
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'extractor', 'format', 'fps', 'frames', 'key', 'poseIdx', 'signer', 'trim', 'video']);
  assert.notEqual(stored.createdAt, 'x');                 // server time
  assert.deepEqual(snapshot(), before);                    // samples + sign.json byte-identical
  assert.deepEqual(fs.readdirSync(dir(KEY)).filter((f) => f.includes('.tmp-')), []);
  // a second save replaces it
  assert.equal(clipApi({ action: 'save', key: KEY, clip: clip(2) }).json.frames, 2);
  assert.equal(JSON.parse(fs.readFileSync(avatarFile(), 'utf8')).frames.length, 2);
});

test('signs.php reports avatar true/false; the full sync ignores avatar.json', () => {
  const signs = signsApi({ method: 'GET' }).json.signs;
  assert.equal(signs[KEY].avatar, true);
  const other = Object.keys(signs).find((k) => !k.startsWith('zz_'));
  assert.equal(signs[other].avatar, fs.existsSync(avatarFile(other)));
  const samplesBefore = samples(KEY);
  const sync = saveApi({ method: 'GET' });
  assert.equal(sync.json.success, true);
  assert.deepEqual(samples(KEY), samplesBefore);
  assert.equal(row(KEY).sign_language, 'ESL');
  const listed = sync.json.gestures[KEY];
  assert.equal(listed.length, samplesBefore.length);               // avatar.json is not a sample
});

test('recording another sample keeps the clip', () => {
  const before = fs.readFileSync(avatarFile(), 'utf8');
  assert.equal(save({ sign_language: 'ESL', text_en: 'Zz Avatar Probe' }).status, 200);
  assert.equal(samples(KEY).length, 2);
  assert.equal(fs.readFileSync(avatarFile(), 'utf8'), before);
});

test('validation: bad clips, unknown signs, bad keys, size limit, method', () => {
  const bad = [
    clip(3, { format: 'x' }), clip(3, { key: 'zz_other' }), clip(3, { fps: 0 }), clip(3, { video: { w: 0, h: 1 } }),
    clip(0), clip(501), clip(3, { frames: [[pose().slice(1), null, null]] }), clip(3, { frames: [[pose(), [[0, 0]], null]] }),
    clip(3, { frames: [[null, null, null]] }), clip(3, { frames: [[pose(), null]] }),
    clip(3, { frames: [[[...pose().slice(0, 10), [0, 'x', 0, 1]], null, null]] }),
    clip(3, { video: { w: '1080', h: 1920 } }), clip(3, { poseIdx: [0, 1] }), clip(3, { trim: { startMs: 90, endMs: 10 } }),
    clip(3, { frames: [[[...pose().slice(0, 10), [0, 0, 0, 2]], null, null]] }),
    clip(3, { frames: [[[...pose().slice(0, 10), [1e9, 0, 0, 1]], null, null]] }),
    clip(3, { trim: null }), clip(3, { trim: { startMs: -5, endMs: 10 } }), clip(3, { signer: 'x'.repeat(81) }), clip(3, { signer: null }), clip(3, { signer: '😀'.repeat(41) }),
  ];
  for (const c of bad) {
    const r = clipApi({ action: 'save', key: KEY, clip: c });
    assert.equal(r.status, 400, JSON.stringify(c).slice(0, 80) + ' -> ' + JSON.stringify(r.json));
  }
  assert.equal(clipApi({ action: 'save', key: 'zz_no_such_sign', clip: clip(1, { key: 'zz_no_such_sign' }) }).status, 404);
  assert.equal(clipApi({ action: 'save', key: '../php', clip: clip(1) }).status, 404);
  assert.equal(clipApi({ action: 'save', key: 'ZZ_AVATAR_PROBE', clip: clip(1) }).status, 404);
  assert.equal(clipApi({ action: 'nope', key: KEY }).status, 400);
  assert.equal(clipApi({ action: 'nope', key: '../x' }).status, 400);
  assert.equal(callApi('avatar_clip.php', { rawBody: 'not json' }).status, 400);
  assert.equal(callApi('avatar_clip.php', { method: 'GET' }).status, 405);
  const big = JSON.stringify({ action: 'save', key: KEY, clip: clip(1, { signer: 'x'.repeat(1048600) }) });
  assert.equal(callApi('avatar_clip.php', { rawBody: big }).status, 413);
  assert.equal(JSON.parse(fs.readFileSync(avatarFile(), 'utf8')).frames.length, 2);   // unchanged
});

test('delete removes only avatar.json; deleting the sign removes the folder with its clip', () => {
  const before = snapshot();
  const r = clipApi({ action: 'delete', key: KEY });
  assert.equal(r.status, 200);
  assert.equal(r.json.deleted, true);
  assert.equal(fs.existsSync(avatarFile()), false);
  assert.deepEqual(snapshot(), before);
  assert.equal(clipApi({ action: 'delete', key: KEY }).json.deleted, false);
  assert.equal(signsApi({ method: 'GET' }).json.signs[KEY].avatar, false);
  assert.equal(clipApi({ action: 'save', key: KEY, clip: clip(2) }).status, 200);
  const del = saveApi({ body: { action: 'delete_gesture', label: KEY } });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(fs.existsSync(dir(KEY)), false);
});
