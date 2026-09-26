// Task 3: save_gesture.php accepting the raw "v3" per-sample format (formatVersion 3) with
// metadata, and the raised MAX_FRAMES_PER_SAMPLE (301) cap. Runs the real endpoint under
// php-cgi.exe (no Apache), exactly like tests/multi-sample/harness.mjs does, but with its own
// probe label so it never collides with that harness's LABEL/cleanup.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { query } from '../categorization/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';
const ENDPOINT = path.join(repo, 'php', 'api', 'save_gesture.php');

const LABEL = 'zz_video_capture_probe';

// Local callEndpoint variant (does not touch tests/multi-sample/harness.mjs or its hardcoded
// LABEL/ffmpeg-stub behaviour). We never send video_base64 in this file's requests, so no ffmpeg
// stubbing is needed.
function callEndpoint({ method = 'POST', body = null, query: qs = '' } = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
  const env = { ...process.env,
    REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: method,
    SCRIPT_FILENAME: ENDPOINT, SCRIPT_NAME: '/SKR/php/api/save_gesture.php',
    QUERY_STRING: qs, CONTENT_TYPE: 'application/json', CONTENT_LENGTH: String(payload.length) };
  const r = spawnSync(PHP_CGI, [], { env, input: payload, maxBuffer: 256 * 1024 * 1024 });
  const out = r.stdout.toString('utf8');
  const cut = out.indexOf('\r\n\r\n');
  const body_ = out.slice(cut >= 0 ? cut + 4 : 0);
  let parsed;
  try {
    parsed = JSON.parse(body_);
  } catch (e) {
    throw new Error('Non-JSON response: ' + JSON.stringify({ stdout: out, stderr: r.stderr?.toString('utf8') }));
  }
  return parsed;
}

function v3Frame(t, hasHand = true) {
  return {
    t,
    hands: hasHand
      ? [{ label: 'Right', score: 0.9, landmarks: Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.2, z: 0.3 })) }]
      : [],
  };
}

function v3Body(overrides = {}) {
  return {
    label: LABEL,
    sign_language: 'ESL',
    formatVersion: 3,
    frames: [v3Frame(0), v3Frame(1 / 15), v3Frame(2 / 15)],
    source: 'video-live',
    repIndex: 1,
    videoWidth: 640,
    videoHeight: 480,
    fps: 15,
    input: { width: 320, height: 240, contentRect: { x: 0, y: 0, w: 320, h: 240 } },
    ...overrides,
  };
}

function labelDir() {
  return path.join(repo, 'saved_gestures', LABEL);
}

function sampleFiles() {
  const dir = labelDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^sample_.*\.json$/.test(f)) : [];
}

function assetsSignsListing() {
  const out = {};
  for (const sub of ['en', 'fil']) {
    const dir = path.join(repo, 'assets', 'signs', sub);
    out[sub] = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  }
  return out;
}

function cleanupProbe() {
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL } });
  fs.rmSync(labelDir(), { recursive: true, force: true });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm']) {
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${LABEL}.${ext}`), { force: true });
  }
}

beforeEach(() => cleanupProbe());
after(() => cleanupProbe());

test('v3 POST with 3 frames succeeds and stores every metadata key with the right types/format', () => {
  const r = callEndpoint({ body: v3Body() });
  assert.equal(r.success, true, JSON.stringify(r));
  const files = sampleFiles();
  assert.equal(files.length, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(labelDir(), files[0]), 'utf8'));

  assert.deepEqual(Object.keys(stored), [
    'label', 'createdAt', 'frameCount', 'format', 'formatVersion', 'signLanguage',
    'source', 'repIndex', 'videoWidth', 'videoHeight', 'fps', 'input', 'frames',
  ]);
  assert.equal(stored.label, LABEL);
  assert.equal(typeof stored.createdAt, 'string');
  assert.equal(stored.frameCount, 3);
  assert.equal(stored.format, 'mediapipe_hands_raw_v3');
  assert.equal(stored.formatVersion, 3);
  assert.equal(stored.signLanguage, 'ESL');
  assert.equal(stored.source, 'video-live');
  assert.equal(stored.repIndex, 1);
  assert.equal(stored.videoWidth, 640);
  assert.equal(stored.videoHeight, 480);
  assert.equal(stored.fps, 15);
  assert.deepEqual(Object.keys(stored.input), ['width', 'height', 'contentRect']);
  assert.equal(stored.input.width, 320);
  assert.equal(stored.input.height, 240);
  assert.deepEqual(Object.keys(stored.input.contentRect), ['x', 'y', 'w', 'h']);
  assert.equal(stored.frames.length, 3);
});

test('v3 POST defaults source to "video-live" when omitted', () => {
  const body = v3Body();
  delete body.source;
  const r = callEndpoint({ body });
  assert.equal(r.success, true, JSON.stringify(r));
  const files = sampleFiles();
  const stored = JSON.parse(fs.readFileSync(path.join(labelDir(), files[0]), 'utf8'));
  assert.equal(stored.source, 'video-live');
});

test('v3 input object drops any non-whitelisted keys', () => {
  const r = callEndpoint({ body: v3Body({ input: { width: 320, height: 240, contentRect: { x: 1, y: 2, w: 3, h: 4 }, extra: 'nope' } }) });
  assert.equal(r.success, true, JSON.stringify(r));
  const files = sampleFiles();
  const stored = JSON.parse(fs.readFileSync(path.join(labelDir(), files[0]), 'utf8'));
  assert.deepEqual(Object.keys(stored.input), ['width', 'height', 'contentRect']);
});

test('v3 with 301 frames succeeds', () => {
  const frames = Array.from({ length: 301 }, (_, i) => v3Frame(i / 15));
  const r = callEndpoint({ body: v3Body({ frames }) });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.frameCount, 301);
});

test('302 frames -> 413 and no file written', () => {
  const frames = Array.from({ length: 302 }, (_, i) => v3Frame(i / 15));
  const r = callEndpoint({ body: v3Body({ frames }) });
  assert.equal(r.success, false);
  assert.match(r.error, /Too many frames in one sample \(max 301\)/);
  assert.equal(sampleFiles().length, 0);
});

test('v3 frame missing hands -> 400 Invalid v3 frame at index N', () => {
  const frames = [v3Frame(0), { t: 1 / 15 }, v3Frame(2 / 15)];
  const r = callEndpoint({ body: v3Body({ frames }) });
  assert.equal(r.success, false);
  assert.match(r.error, /Invalid v3 frame at index 1/);
  assert.equal(sampleFiles().length, 0);
});

test('v3 frame with non-numeric t -> 400 Invalid v3 frame at index N', () => {
  const frames = [v3Frame(0), { t: 'nope', hands: [] }];
  const r = callEndpoint({ body: v3Body({ frames }) });
  assert.equal(r.success, false);
  assert.match(r.error, /Invalid v3 frame at index 1/);
  assert.equal(sampleFiles().length, 0);
});

test('v2 POST (no formatVersion) stores exactly the old six keys, byte-for-byte shape', () => {
  const frames = [{ index: 0, timestamp: 0, landmarks: Array(126).fill(0.1) }];
  const r = callEndpoint({ body: { label: LABEL, sign_language: 'ESL', frames } });
  assert.equal(r.success, true, JSON.stringify(r));
  const files = sampleFiles();
  const stored = JSON.parse(fs.readFileSync(path.join(labelDir(), files[0]), 'utf8'));
  assert.deepEqual(Object.keys(stored), ['label', 'createdAt', 'frameCount', 'format', 'signLanguage', 'frames']);
  assert.equal(stored.format, 'mediapipe_hands_landmarks_v2');
});

test('a v3 POST creates no file in assets/signs/en|fil and response videoAsset is null', () => {
  const before = assetsSignsListing();
  const r = callEndpoint({ body: v3Body() });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.videoAsset, null);
  const after = assetsSignsListing();
  assert.deepEqual(after, before);
});

test('the gesture_recordings row exists with frame_count matching frames sent', () => {
  const r = callEndpoint({ body: v3Body() });
  assert.equal(r.success, true, JSON.stringify(r));
  const rows = query(
    `SELECT gr.frame_count FROM gesture_recordings gr
     JOIN gestures g ON g.id = gr.gesture_id
     WHERE g.label = '${LABEL}'`
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].frame_count), 3);
});
