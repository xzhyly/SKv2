// Bulk video importer: save_gesture.php's two optional v3 fields (signer, importId) and the
// "same importId twice is a no-op" answer. Runs the real endpoint under php-cgi against the live
// DB/disk with zz_-prefixed probe signs only (tests/sign-texts/api-helper.mjs), cleaned before and
// after. Every other folder under saved_gestures/ is hashed before and after the run.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { saveApi, cleanZz, dir, samples, saved, sql, repo, frames as v2Frames } from '../sign-texts/api-helper.mjs';
import { PHP_CGI } from '../normalization/clone-helper.mjs';

const KEY = 'zz_bulk_import_probe';
const IMPORT_ID = '0123456789abcdef0123456789abcdef';
const V3_KEYS = ['label', 'createdAt', 'frameCount', 'format', 'formatVersion', 'signLanguage',
  'source', 'repIndex', 'videoWidth', 'videoHeight', 'fps', 'input', 'frames'];
const V2_KEYS = ['label', 'createdAt', 'frameCount', 'format', 'signLanguage', 'frames'];
// Response keys of a normal save (php/api/save_gesture.php's final json_encode).
const SAVE_RESPONSE_KEYS = ['success', 'label', 'signLanguage', 'set', 'textEn', 'textFil', 'category',
  'file', 'videoAsset', 'frameCount', 'dbGestureId', 'dbGestureCreated', 'dbRecordingId',
  'labelSampleCount', 'videoSkipped', 'videoTranscoded', 'videoExisting'];

function v3Frame(t) {
  return { t, hands: [{ label: 'Right', score: 0.9, landmarks: Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.2, z: 0.3 })) }] };
}
function v3Body(overrides = {}) {
  return {
    label: KEY, sign_language: 'ESL', formatVersion: 3,
    frames: [v3Frame(0), v3Frame(1 / 15), v3Frame(2 / 15)],
    source: 'video-import', repIndex: 2, videoWidth: 640, videoHeight: 480, fps: 15,
    input: { width: 320, height: 240, contentRect: { x: 0, y: 0, w: 320, h: 240 } },
    ...overrides,
  };
}
const post = (body) => saveApi({ body });
const stored = (file) => JSON.parse(fs.readFileSync(path.join(dir(KEY), file), 'utf8'));
const recordingRows = () => sql(
  `SELECT gr.sample_path FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id WHERE g.label = '${KEY}'`);
const gestureRows = () => sql(`SELECT id FROM gestures WHERE label = '${KEY}'`);

// sha256 of every file in every non-zz folder under saved_gestures/ (relative path -> hash).
function hashSavedGestures() {
  const out = {};
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (rel === '' && e.name.startsWith('zz_')) continue;
      const p = path.join(abs, e.name);
      const r = rel === '' ? e.name : rel + '/' + e.name;
      if (e.isDirectory()) walk(p, r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(saved, '');
  return out;
}

let hashesBefore;
before(() => { cleanZz(); hashesBefore = hashSavedGestures(); });
beforeEach(() => cleanZz());
after(() => cleanZz());

test('v3 save with signer + importId stores both, names the file after the importId, adds the DB row', () => {
  const r = post(v3Body({ signer: 'P03', importId: IMPORT_ID }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.success, true);
  assert.equal('duplicate' in r.json, false);
  assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
  assert.equal(r.json.file, `saved_gestures/${KEY}/sample_i${IMPORT_ID}.json`);

  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  const s = stored(`sample_i${IMPORT_ID}.json`);
  assert.equal(s.signer, 'P03');
  assert.equal(s.importId, IMPORT_ID);
  assert.equal(s.source, 'video-import');
  assert.equal(s.repIndex, 2);
  assert.equal(s.format, 'mediapipe_hands_raw_v3');
  assert.equal(s.frames.length, 3);
  // The 13 old keys, in the old order, plus exactly the two new ones.
  assert.deepEqual(Object.keys(s).filter(k => k !== 'signer' && k !== 'importId'), V3_KEYS);
  assert.equal(Object.keys(s).length, V3_KEYS.length + 2);

  const rows = recordingRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sample_path, `saved_gestures/${KEY}/sample_i${IMPORT_ID}.json`);
});

test('the same request again answers duplicate:true and writes nothing', async () => {
  const body = v3Body({ signer: 'P03', importId: IMPORT_ID });
  const first = post(body);
  assert.equal(first.json.success, true, JSON.stringify(first.json));
  const samplePath = path.join(dir(KEY), `sample_i${IMPORT_ID}.json`);
  const signPath = path.join(dir(KEY), 'sign.json');
  const sampleBytes = fs.readFileSync(samplePath);
  const signBytes = fs.readFileSync(signPath);
  const sampleMtime = fs.statSync(samplePath).mtimeMs;
  const signMtime = fs.statSync(signPath).mtimeMs;
  const gestureId = gestureRows()[0].id;

  // sign.json's updatedAt and a sample's createdAt have 1 s resolution: wait past it so a rewrite
  // would change the bytes.
  await sleep(1100);

  const second = post(body);
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.deepEqual(second.json, {
    success: true, duplicate: true, label: KEY, set: 'ESL', signLanguage: 'ESL',
    file: `saved_gestures/${KEY}/sample_i${IMPORT_ID}.json`, frameCount: 3,
  });

  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  assert.deepEqual(fs.readdirSync(dir(KEY)).sort(), [`sample_i${IMPORT_ID}.json`, 'sign.json']);
  assert.ok(fs.readFileSync(samplePath).equals(sampleBytes), 'sample file bytes changed');
  assert.ok(fs.readFileSync(signPath).equals(signBytes), 'sign.json bytes changed');
  assert.equal(fs.statSync(samplePath).mtimeMs, sampleMtime);
  assert.equal(fs.statSync(signPath).mtimeMs, signMtime);
  assert.equal(recordingRows().length, 1);
  assert.deepEqual(gestureRows().map(g => g.id), [gestureId]);
});

test('a different importId for the same sign is a second sample, not a duplicate', () => {
  const other = 'ffffffffffffffffffffffffffffffff';
  assert.equal(post(v3Body({ signer: 'P03', importId: IMPORT_ID })).json.success, true);
  const r = post(v3Body({ signer: 'P04', importId: other }));
  assert.equal(r.json.success, true, JSON.stringify(r.json));
  assert.equal('duplicate' in r.json, false);
  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`, `sample_i${other}.json`].sort());
  assert.equal(recordingRows().length, 2);
});

test('invalid signer -> 400 "signer must be P01..P99" and nothing written', () => {
  for (const signer of ['P00', 'P100', 'X01', 5]) {
    const r = post(v3Body({ signer, importId: IMPORT_ID }));
    assert.equal(r.status, 400, `signer ${JSON.stringify(signer)}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.success, false);
    assert.equal(r.json.error, 'signer must be P01..P99');
    assert.equal(fs.existsSync(dir(KEY)), false, `folder created for signer ${JSON.stringify(signer)}`);
    assert.equal(gestureRows().length, 0);
    assert.equal(recordingRows().length, 0);
  }
});

test('invalid importId -> 400 and nothing written', () => {
  const bad = [
    '0123456789abcdef',                    // too short
    '0123456789ABCDEF0123456789ABCDEF',    // upper-case hex
    'g123456789abcdef0123456789abcdef',    // non-hex
    '0123456789abcdef0123456789abcdef0',   // too long
    12345,                                 // not a string
  ];
  for (const importId of bad) {
    const r = post(v3Body({ signer: 'P03', importId }));
    assert.equal(r.status, 400, `importId ${JSON.stringify(importId)}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.success, false);
    assert.match(r.json.error, /importId/);
    assert.equal(fs.existsSync(dir(KEY)), false, `folder created for importId ${JSON.stringify(importId)}`);
    assert.equal(gestureRows().length, 0);
    assert.equal(recordingRows().length, 0);
  }
});

test('a v3 save without the two fields behaves as before (file name, stored keys, response keys)', () => {
  const r = post(v3Body({ source: 'video-live' }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.success, true);
  assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
  assert.equal('duplicate' in r.json, false);
  const files = samples(KEY);
  assert.equal(files.length, 1);
  assert.match(files[0], /^sample_\d+_[0-9a-f]{6}\.json$/);
  const s = stored(files[0]);
  assert.deepEqual(Object.keys(s), V3_KEYS);
  assert.equal('signer' in s, false);
  assert.equal('importId' in s, false);
  // Stored compact, as before.
  assert.equal(fs.readFileSync(path.join(dir(KEY), files[0]), 'utf8'), JSON.stringify(s));
  assert.equal(recordingRows().length, 1);
});

test('a v3 save without the fields is never a duplicate: two saves give two samples', () => {
  assert.equal(post(v3Body()).json.success, true);
  const r = post(v3Body());
  assert.equal(r.json.success, true);
  assert.equal('duplicate' in r.json, false);
  assert.equal(samples(KEY).length, 2);
});

test('a v2 save (no formatVersion) ignores signer / importId, valid or not', () => {
  for (const extra of [{ signer: 'P03', importId: IMPORT_ID }, { signer: 'X01', importId: 'nope' }]) {
    cleanZz();
    const body = { label: KEY, sign_language: 'ESL', frames: v2Frames(), ...extra };
    for (let n = 1; n <= 2; n++) {   // twice: a v2 save is never a duplicate
      const r = post(body);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.success, true);
      assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
      assert.equal(samples(KEY).length, n);
    }
    for (const f of samples(KEY)) {
      assert.match(f, /^sample_\d+_[0-9a-f]{6}\.json$/);
      const s = stored(f);
      assert.deepEqual(Object.keys(s), V2_KEYS);
      assert.equal(s.format, 'mediapipe_hands_landmarks_v2');
    }
  }
});

test('the set-collision 409 still comes before the duplicate check', () => {
  const first = post(v3Body({ signer: 'P03', importId: IMPORT_ID }));
  assert.equal(first.json.success, true, JSON.stringify(first.json));
  const sampleBytes = fs.readFileSync(path.join(dir(KEY), `sample_i${IMPORT_ID}.json`));

  const r = post(v3Body({ signer: 'P03', importId: IMPORT_ID, sign_language: 'FSL' }));
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.success, false);
  assert.equal(r.json.existingSet, 'ESL');
  assert.equal('duplicate' in r.json, false);
  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  assert.ok(fs.readFileSync(path.join(dir(KEY), `sample_i${IMPORT_ID}.json`)).equals(sampleBytes));
  assert.equal(recordingRows().length, 1);
});

test('signer only (no importId): timestamp file name, signer stored, never a duplicate', () => {
  for (let n = 1; n <= 2; n++) {
    const r = post(v3Body({ signer: 'P07' }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
    assert.equal(samples(KEY).length, n);
  }
  for (const f of samples(KEY)) {
    assert.match(f, /^sample_\d+_[0-9a-f]{6}\.json$/);
    const s = stored(f);
    assert.equal(s.signer, 'P07');
    assert.equal('importId' in s, false);
    assert.deepEqual(Object.keys(s).filter(k => k !== 'signer'), V3_KEYS);
  }
  assert.equal(recordingRows().length, 2);
});

test('importId only (no signer): importId file name and key, no signer key', () => {
  const r = post(v3Body({ importId: IMPORT_ID }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  const s = stored(`sample_i${IMPORT_ID}.json`);
  assert.equal(s.importId, IMPORT_ID);
  assert.equal('signer' in s, false);
  assert.deepEqual(Object.keys(s).filter(k => k !== 'importId'), V3_KEYS);
  assert.equal(post(v3Body({ importId: IMPORT_ID })).json.duplicate, true);
});

test('a trailing newline or lower case is rejected: "P03\\n", "p03", importId + "\\n" -> 400', () => {
  for (const extra of [{ signer: 'P03\n' }, { signer: 'p03' }, { signer: ' P03' }, { importId: IMPORT_ID + '\n' }]) {
    const r = post(v3Body({ signer: 'P03', importId: IMPORT_ID, ...extra }));
    assert.equal(r.status, 400, `${JSON.stringify(extra)}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.success, false);
    assert.equal(fs.existsSync(dir(KEY)), false);
    assert.equal(gestureRows().length, 0);
  }
});

test('signer:null / importId:null behave as "not sent"', () => {
  const r = post(v3Body({ signer: null, importId: null }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json), SAVE_RESPONSE_KEYS);
  const files = samples(KEY);
  assert.equal(files.length, 1);
  assert.match(files[0], /^sample_\d+_[0-9a-f]{6}\.json$/);
  assert.deepEqual(Object.keys(stored(files[0])), V3_KEYS);
});

// Raw php-cgi call for the failure cases: the response may carry a PHP warning before the JSON
// (display_errors), which api-helper's callApi would refuse to parse.
function postRaw(body) {
  const payload = Buffer.from(JSON.stringify(body));
  const script = path.join(repo, 'php', 'api', 'save_gesture.php');
  const env = { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'POST',
    SCRIPT_FILENAME: script, SCRIPT_NAME: '/SKR/php/api/save_gesture.php',
    QUERY_STRING: '', CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const m = /^Status:\s*(\d+)/im.exec(cut >= 0 ? out.slice(0, cut) : '');
  return { status: m ? Number(m[1]) : 200, text: cut >= 0 ? out.slice(cut + 4) : out };
}

test('failed import (sign.json cannot be written) leaves no sample file; the retry is a real save', () => {
  // sign.json pre-created as a DIRECTORY: write_sign_json() fails after the sample file is written.
  fs.mkdirSync(path.join(dir(KEY), 'sign.json'), { recursive: true });
  const body = v3Body({ signer: 'P03', importId: IMPORT_ID });

  const failed = postRaw(body);
  assert.equal(failed.status, 500, failed.text);
  assert.match(failed.text, /Unable to write sign\.json/);
  assert.deepEqual(samples(KEY), [], 'the sample file of the failed import was left behind');
  assert.equal(recordingRows().length, 0);

  fs.rmSync(path.join(dir(KEY), 'sign.json'), { recursive: true, force: true });
  const retry = post(body);
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  assert.equal(retry.json.success, true);
  assert.equal('duplicate' in retry.json, false);
  assert.deepEqual(Object.keys(retry.json), SAVE_RESPONSE_KEYS);
  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  assert.ok(fs.statSync(path.join(dir(KEY), 'sign.json')).isFile());
  assert.equal(recordingRows().length, 1);
});

test('failed import (DB recording insert fails) leaves no sample file; the retry is a real save', () => {
  // A sample larger than the DB server's max_allowed_packet: the file and sign.json are written,
  // then the gesture_recordings insert fails inside save_gesture_recording_to_db() -- the path only
  // the shutdown guard covers. Extra frame keys are stored as sent, so padding makes it big enough.
  const limit = Number(sql('SELECT @@max_allowed_packet AS n')[0].n);
  const padLen = Math.ceil((limit * 2) / 301);
  const big = Array.from({ length: 301 }, (_, i) => ({ ...v3Frame(i / 15), pad: 'x'.repeat(padLen) }));

  const failed = postRaw(v3Body({ signer: 'P03', importId: IMPORT_ID, frames: big }));
  assert.notEqual(failed.status, 200, failed.text.slice(0, 300));
  assert.equal(/"success":true/.test(failed.text), false, failed.text.slice(0, 300));
  assert.match(failed.text, /DB recording insert failed/);   // the DB step, not an earlier rejection
  assert.deepEqual(samples(KEY), [], 'the sample file of the failed import was left behind');
  assert.equal(recordingRows().length, 0);

  const retry = post(v3Body({ signer: 'P03', importId: IMPORT_ID }));
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  assert.equal(retry.json.success, true);
  assert.equal('duplicate' in retry.json, false);
  assert.deepEqual(samples(KEY), [`sample_i${IMPORT_ID}.json`]);
  assert.equal(recordingRows().length, 1);
});

// Keep this test last: it compares against the hashes taken before any test ran.
test('every existing (non-zz) file under saved_gestures/ is byte-identical after the run', () => {
  const now = hashSavedGestures();
  assert.ok(Object.keys(hashesBefore).length > 0, 'no existing sample files were hashed');
  assert.deepEqual(now, hashesBefore);
});
