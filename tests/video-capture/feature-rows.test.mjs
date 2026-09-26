// Tests for js/gesture-data.js's recordingToFeatureRows(): the load-time normalization that
// turns a stored sample's frames into the 126-float feature rows the k-NN classifier
// (knnPredict / trainModel / mergeSavedGestureSamples) consumes. v2 samples (bare 126-float
// frames, or {landmarks:[126]}) must keep producing byte-identical rows to the phase-base
// commit (813bfbe). v3 samples (raw MediaPipe frames, `{ t, hands: [...] }`) are new: 0-hand
// frames give no row, otherwise flattenLandmarks(frame.hands.map(h => h.landmarks)), and the
// result is evenly subsampled to at most MAX_ROWS_PER_RAW_SAMPLE (30) rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadGestureData } from './load-gesture-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PHASE_BASE_COMMIT = '813bfbe';

const currentSource = fs.readFileSync(path.join(REPO_ROOT, 'js', 'gesture-data.js'), 'utf8');
const baseSource = execFileSync('git', ['show', `${PHASE_BASE_COMMIT}:js/gesture-data.js`], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 32,
});

const current = loadGestureData(currentSource);
const base = loadGestureData(baseSource);

// current/base each run gesture-data.js in their own node:vm context, so any array or object
// their functions construct (e.g. flattenHand's `out = []`, or a .filter()/.map() result) is
// an object from THAT vm realm, with a different Array.prototype than this test file's realm.
// node:assert/strict's deepEqual checks prototype identity, so comparing such a value directly
// against a plain array literal here fails with "same structure but not reference-equal" even
// when every element matches. A JSON round-trip rebuilds the value as a plain array/object in
// this realm before comparing; safe here since every value compared is a plain array of finite
// numbers (or nested arrays thereof) with no NaN/Infinity/-0.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// A fake 21-point hand landmark array; flattenHand() only cares about x/y/z per point.
function fakeHand(seed) {
  const points = [];
  for (let i = 0; i < 21; i++) {
    points.push({ x: seed + i * 0.01, y: seed + i * 0.02, z: seed + i * 0.003 });
  }
  return points;
}

function findSampleFiles() {
  const dirs = ['saved_gestures', 'saved_gestures_fsl'];
  const files = [];
  for (const dir of dirs) {
    const base = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const label of fs.readdirSync(base)) {
      const labelDir = path.join(base, label);
      if (!fs.statSync(labelDir).isDirectory()) continue;
      for (const entry of fs.readdirSync(labelDir)) {
        if (/^sample_.*\.json$/.test(entry)) {
          files.push(path.join(labelDir, entry));
        }
      }
    }
  }
  return files;
}

test('golden: every saved sample on disk produces byte-identical rows vs the phase-base commit', () => {
  const files = findSampleFiles();
  assert.ok(files.length > 0, 'expected to find at least one saved sample file');

  let totalRows = 0;
  for (const file of files) {
    const sample = JSON.parse(fs.readFileSync(file, 'utf8'));
    const currentRows = current.recordingToFeatureRows(sample);
    const baseRows = base.recordingToFeatureRows(sample);
    assert.deepEqual(
      toPlain(currentRows),
      toPlain(baseRows),
      `rows differ for ${path.relative(REPO_ROOT, file)}`
    );
    totalRows += currentRows.length;
  }

  // Reported in the task report: file count and total row count compared.
  console.log(`golden test: compared ${files.length} sample files, ${totalRows} total rows`);
});

test('v3 sample: a 0-hand frame gives no row', () => {
  const sample = {
    format: 'mediapipe_hands_raw_v3',
    frames: [
      { t: 0, hands: [] },
      { t: 66, hands: [] },
    ],
  };
  const rows = current.recordingToFeatureRows(sample);
  assert.deepEqual(toPlain(rows), []);
});

test('v3 sample: a 1-hand frame gives hand63 + 63 zeros, matching flattenLandmarks([landmarks])', () => {
  const hand = fakeHand(0.1);
  const sample = {
    format: 'mediapipe_hands_raw_v3',
    frames: [{ t: 0, hands: [{ label: 'Right', score: 0.9, landmarks: hand }] }],
  };
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 126);
  assert.deepEqual(toPlain(rows[0].slice(63)), Array(63).fill(0));
  // Cross-check against flattenLandmarks([landmarks]) via the same-shaped 1-hand v3 frame
  // constructed directly with an array frame (bare landmarks path is unaffected by this task,
  // but the raw path must match what flattenLandmarks would produce for a single hand).
  const expected = current.recordingToFeatureRows({
    frames: [{ landmarks: [hand] }],
  })[0];
  assert.deepEqual(toPlain(rows[0]), toPlain(expected));
});

test('v3 sample: a 2-hand frame keeps stored order', () => {
  const handA = fakeHand(0.1);
  const handB = fakeHand(0.5);
  const sample = {
    format: 'mediapipe_hands_raw_v3',
    frames: [
      {
        t: 0,
        hands: [
          { label: 'Left', score: 0.9, landmarks: handA },
          { label: 'Right', score: 0.8, landmarks: handB },
        ],
      },
    ],
  };
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 1);
  const expected = current.recordingToFeatureRows({ frames: [{ landmarks: [handA, handB] }] })[0];
  assert.deepEqual(toPlain(rows[0]), toPlain(expected));
});

// Builds a v3 sample with N hand-present frames (all 1-hand, distinct seeds so rows are
// distinguishable), interleaved with `emptyEvery`-th empty frames when given.
function buildRawSample(n, { emptyEvery = 0 } = {}) {
  const frames = [];
  let handCount = 0;
  const total = emptyEvery ? n + Math.floor(n / (emptyEvery)) : n;
  for (let i = 0; handCount < n; i++) {
    if (emptyEvery && (i + 1) % (emptyEvery + 1) === 0) {
      frames.push({ t: i * 66, hands: [] });
    } else {
      frames.push({ t: i * 66, hands: [{ label: 'Right', score: 0.9, landmarks: fakeHand(0.01 * (handCount + 1)) }] });
      handCount++;
    }
  }
  return { format: 'mediapipe_hands_raw_v3', frames };
}

test('subsampling: 75 hand frames -> exactly 30 rows, first/last included, order preserved, indices match formula', () => {
  const sample = buildRawSample(75);
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 30);

  // Recompute the full (unsubsampled) row set the same way the implementation would, to check
  // against the exact index formula and first/last/order guarantees.
  const fullRows = sample.frames
    .filter((f) => f.hands.length > 0)
    .map((f) => current.recordingToFeatureRows({ frames: [{ landmarks: f.hands.map((h) => h.landmarks) }] })[0]);
  assert.equal(fullRows.length, 75);

  const expectedIndices = [];
  for (let i = 0; i < 30; i++) {
    expectedIndices.push(Math.round((i * (75 - 1)) / 29));
  }
  assert.deepEqual(toPlain(rows[0]), toPlain(fullRows[expectedIndices[0]]));
  assert.deepEqual(toPlain(rows[29]), toPlain(fullRows[expectedIndices[29]]));
  assert.equal(expectedIndices[0], 0, 'first source row included');
  assert.equal(expectedIndices[29], 74, 'last source row included');

  for (let i = 0; i < 30; i++) {
    assert.deepEqual(toPlain(rows[i]), toPlain(fullRows[expectedIndices[i]]), `row ${i} matches expected source index`);
  }
  // order preserved (indices strictly non-decreasing)
  for (let i = 1; i < expectedIndices.length; i++) {
    assert.ok(expectedIndices[i] >= expectedIndices[i - 1]);
  }
});

test('subsampling: 30 hand frames -> all 30 rows kept', () => {
  const sample = buildRawSample(30);
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 30);
});

test('subsampling: 12 hand frames -> all 12 rows kept', () => {
  const sample = buildRawSample(12);
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 12);
});

test('subsampling: a v3 sample with 40 frames of which 20 are empty -> 20 rows (skip before subsample)', () => {
  // 20 hand-present frames + 20 empty frames interleaved 1:1.
  const frames = [];
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) {
      frames.push({ t: i * 66, hands: [{ label: 'Right', score: 0.9, landmarks: fakeHand(0.01 * (i + 1)) }] });
    } else {
      frames.push({ t: i * 66, hands: [] });
    }
  }
  const sample = { format: 'mediapipe_hands_raw_v3', frames };
  assert.equal(frames.length, 40);
  assert.equal(frames.filter((f) => f.hands.length > 0).length, 20);
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 20);
});

test('v2 sample with 45 frames -> 45 rows (v2 is never subsampled)', () => {
  const frames = [];
  for (let i = 0; i < 45; i++) {
    frames.push({ landmarks: fakeHand(0.01 * (i + 1)) });
  }
  const sample = { frames };
  const rows = current.recordingToFeatureRows(sample);
  assert.equal(rows.length, 45);
});
