// php/api/sign_audio.php + signs.php `audio` (talk-turns-audio phase, docs/superpowers/specs/
// 2026-10-19-talk-turns-audio-design.md section 5), under php-cgi with the live DB, on zz probe signs
// only (made through save_gesture.php, removed after):
//   - admin only: a guest and a user get 403 and nothing is written
//   - upload webm / mp3 / m4a / wav / ogg -> saved_gestures/<key>/audio_<lang>.<sniffed ext>, any other
//     extension of that language replaced; signs.php GET lists it with ?v=<mtime>
//   - refused: not audio, over 2 MB, no file, bad lang, unknown sign, Filipino audio for a letter
//   - delete removes only that language's file; samples, sign.json and avatar.json are never touched
// Run: node --test tests/talk-turns-audio/sign-audio-endpoint.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adminCookie, loginCookie } from '../conversations/helper.mjs';
import { makeUser, cleanupAccounts } from '../accounts-quiz/helper.mjs';
import { save, signsApi, cleanZz, dir, repo, sql } from '../sign-texts/api-helper.mjs';

const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';

// POSTs to php/api/sign_audio.php: fields + optional file ({ name, data }) as multipart, or a JSON body.
function audioApi({ fields = {}, file = null, json = null, cookie = '', method = 'POST' } = {}) {
  let payload, type;
  if (json) {
    payload = Buffer.from(JSON.stringify(json));
    type = 'application/json';
  } else {
    const b = '----zz' + crypto.randomBytes(8).toString('hex');
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    if (file) {
      parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      parts.push(file.data, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${b}--\r\n`));
    payload = Buffer.concat(parts);
    type = `multipart/form-data; boundary=${b}`;
  }
  const env = { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: method,
    SCRIPT_FILENAME: path.join(repo, 'php', 'api', 'sign_audio.php'), SCRIPT_NAME: '/SKR/php/api/sign_audio.php',
    CONTENT_TYPE: type, CONTENT_LENGTH: String(payload.length), HTTP_COOKIE: cookie };
  const r = spawnSync(PHP_CGI, ['-d', 'upload_max_filesize=8M', '-d', 'post_max_size=16M'], { env, input: payload, maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const m = /^Status:\s*(\d+)/im.exec(cut >= 0 ? out.slice(0, cut) : '');
  let body = null;
  try { body = JSON.parse(cut >= 0 ? out.slice(cut + 4) : out); } catch { /* not JSON */ }
  return { status: m ? Number(m[1]) : 200, json: body, raw: out };
}

// Minimal files with the right first bytes for each format.
const AUDIO = {
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(200)]),
  ogg: Buffer.concat([Buffer.from('OggS'), crypto.randomBytes(200)]),
  wav: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE'), crypto.randomBytes(200)]),
  mp3: Buffer.concat([Buffer.from('ID3'), crypto.randomBytes(200)]),
  m4a: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), crypto.randomBytes(200)]),
};
const KEY = 'zz_audio_probe';
const LETTER = 'zz_audio_letter';
const files = (key) => fs.readdirSync(dir(key)).sort();
const audioFiles = (key) => files(key).filter((f) => f.startsWith('audio_'));
const snapshot = (key) => Object.fromEntries(files(key).filter((f) => !f.startsWith('audio_')).map((f) => [f, fs.readFileSync(path.join(dir(key), f)).toString('base64')]));
const upload = (lang, ext, cookie, key = KEY, data = AUDIO[ext]) => audioApi({ fields: { action: 'upload', key, lang }, file: { name: 'take.' + ext, data }, cookie });

let admin, user;
before(() => {
  cleanZz(); cleanupAccounts();
  assert.equal(save({ sign_language: 'BOTH', text_en: 'Zz Audio Probe', text_fil: 'Zz Tunog' }).status, 200);
  assert.equal(save({ sign_language: 'ESL', text_en: 'Zz Audio Letter' }).status, 200);
  sql(`UPDATE gestures SET category = 'letter' WHERE label = '${LETTER}'`);
  fs.writeFileSync(path.join(dir(KEY), 'avatar.json'), '{"zz":1}');
  admin = adminCookie();
  user = makeUser('Zz Audio User').cookie;
});
after(() => { cleanZz(); cleanupAccounts(); });

test('admin only: guest and user get 403, nothing written', () => {
  for (const cookie of ['', user]) {
    assert.equal(upload('en', 'webm', cookie).status, 403);
    assert.equal(audioApi({ json: { action: 'delete', key: KEY, lang: 'en' }, cookie }).status, 403);
  }
  assert.deepEqual(audioFiles(KEY), []);
  assert.equal(audioApi({ method: 'GET', cookie: admin }).status, 405);
});

test('upload each format: stored as audio_<lang>.<sniffed ext>, replacing the previous one; listed by signs.php', () => {
  const keep = snapshot(KEY);
  for (const ext of ['webm', 'mp3', 'm4a', 'wav', 'ogg']) {
    const r = upload('en', ext, admin);
    assert.equal(r.status, 200, r.raw);
    assert.deepEqual(audioFiles(KEY), [`audio_en.${ext}`]);
    assert.match(r.json.audio.en, new RegExp(`^saved_gestures/${KEY}/audio_en\\.${ext}\\?v=\\d+$`));
    assert.equal(r.json.audio.fil, null);
  }
  // the name sent does not decide the extension: the bytes do
  const r = audioApi({ fields: { action: 'upload', key: KEY, lang: 'fil' }, file: { name: 'take.mp3', data: AUDIO.webm }, cookie: admin });
  assert.equal(r.status, 200);
  assert.deepEqual(audioFiles(KEY), ['audio_en.ogg', 'audio_fil.webm']);
  const s = signsApi({ method: 'GET' }).json.signs[KEY];
  assert.match(s.audio.en, /audio_en\.ogg\?v=\d+$/);
  assert.match(s.audio.fil, /audio_fil\.webm\?v=\d+$/);
  assert.equal(s.avatar, true);
  assert.deepEqual(snapshot(KEY), keep, 'samples, sign.json and avatar.json untouched');
  assert.deepEqual(signsApi({ method: 'GET' }).json.signs.hello.audio, { en: null, fil: null });
});

test('refused: not audio, over 2 MB, no file, bad lang, unknown sign, Filipino for a letter', () => {
  const before = audioFiles(KEY);
  assert.equal(upload('en', 'txt', admin, KEY, Buffer.from('hello, this is not audio at all')).status, 400);
  const big = Buffer.concat([AUDIO.webm, Buffer.alloc(2097152)]);
  assert.equal(upload('en', 'webm', admin, KEY, big).status, 413);
  assert.equal(audioApi({ fields: { action: 'upload', key: KEY, lang: 'en' }, cookie: admin }).status, 400);
  assert.equal(upload('es', 'webm', admin).status, 400);
  assert.equal(upload('en', 'webm', admin, 'zz_no_such_sign').status, 404);
  assert.equal(upload('en', 'webm', admin, '../hello').status, 404);
  assert.equal(audioApi({ fields: { action: 'nope', key: KEY, lang: 'en' }, cookie: admin }).status, 400);
  assert.deepEqual(audioFiles(KEY), before);
  const f = upload('fil', 'webm', admin, LETTER);
  assert.equal(f.status, 400);
  assert.match(f.json.error, /English audio only/);
  assert.equal(upload('en', 'webm', admin, LETTER).status, 200);
  assert.deepEqual(audioFiles(LETTER), ['audio_en.webm']);
});

test('delete removes only that language; deleting again is fine', () => {
  const keep = snapshot(KEY);
  const r = audioApi({ json: { action: 'delete', key: KEY, lang: 'fil' }, cookie: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.deleted, true);
  assert.deepEqual(audioFiles(KEY), ['audio_en.ogg']);
  assert.equal(r.json.audio.fil, null);
  const again = audioApi({ json: { action: 'delete', key: KEY, lang: 'fil' }, cookie: admin });
  assert.equal(again.status, 200);
  assert.equal(again.json.deleted, false);
  assert.deepEqual(snapshot(KEY), keep);
});
