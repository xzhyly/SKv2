// Live-DB tests (via php-cgi, same harness as tests/multi-sample) for the `categories` key added
// to the dataset GET response by list_samples() in save_gesture.php (Task 2 of the
// gesture-categorization phase). Covers both ?no_sync=1 and full-sync loads.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { callEndpoint, fixtureFrames, repo } from '../multi-sample/harness.mjs';
import { query, exec } from './db.mjs';
import fs from 'node:fs';
import path from 'node:path';

const HTTP_LABELS = ['zz_listcat_number', 'zz_listcat_fsl', 'zz_listcat_nodbrow'];

function cleanupLabel(label) {
  callEndpoint({ body: { action: 'delete_gesture', label }, stub: false });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm']) {
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${label}.${ext}`), { force: true });
  }
  // delete_gesture removes disk folders for both saved_gestures and saved_gestures_fsl already,
  // but be thorough in case a probe wrote directly without going through the endpoint.
  for (const folder of ['saved_gestures', 'saved_gestures_fsl']) {
    fs.rmSync(path.join(repo, folder, label), { recursive: true, force: true });
  }
}

function cleanupAll() {
  for (const l of HTTP_LABELS) cleanupLabel(l);
  const list = HTTP_LABELS.map(l => `'${l}'`).join(',');
  exec(`DELETE FROM gestures WHERE label IN (${list})`);
}

function post(label, extra = {}) {
  return callEndpoint({ body: { label, sign_language: 'ESL', frames: fixtureFrames(3), ...extra } });
}

beforeEach(cleanupAll);
after(cleanupAll);

test('no_sync GET response has categories.ESL and categories.FSL objects; every gestures label key appears under at least one set with a valid category', () => {
  const r = callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false });
  assert.equal(r.success, true);
  assert.ok(r.categories, 'response should have a categories key');
  assert.ok(r.categories.ESL && typeof r.categories.ESL === 'object');
  assert.ok(r.categories.FSL && typeof r.categories.FSL === 'object');
  const valid = new Set(['word', 'letter', 'number', 'phrase']);
  for (const label of Object.keys(r.gestures)) {
    const samples = r.gestures[label];
    const sets = new Set(samples.map(s => (String(s.signLanguage || 'ESL').toUpperCase() === 'FSL' ? 'FSL' : 'ESL')));
    const foundIn = [...sets].filter(set => Object.prototype.hasOwnProperty.call(r.categories[set], label));
    assert.ok(foundIn.length > 0, `label "${label}" should appear under at least one of its sign sets in categories`);
    for (const set of foundIn) {
      assert.ok(valid.has(r.categories[set][label]), `categories.${set}.${label} should be a valid category, got ${r.categories[set][label]}`);
    }
  }
});

test('a probe saved with category: "number" shows "number" in both a no_sync and a full load', () => {
  const saveResult = post('zz_listcat_number', { category: 'number' });
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.category, 'number');

  const noSync = callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false });
  assert.equal(noSync.categories.ESL['zz_listcat_number'], 'number');

  const full = callEndpoint({ method: 'GET', stub: false });
  assert.equal(full.categories.ESL['zz_listcat_number'], 'number');
});

test('a probe saved to FSL appears under categories.FSL, not categories.ESL', () => {
  const r = post('zz_listcat_fsl', { sign_language: 'FSL', category: 'letter' });
  assert.equal(r.success, true);

  const noSync = callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false });
  assert.equal(noSync.categories.FSL['zz_listcat_fsl'], 'letter');
  assert.equal(Object.prototype.hasOwnProperty.call(noSync.categories.ESL, 'zz_listcat_fsl'), false);
});

test('a label on disk with no DB row reports its heuristic value in a no_sync load', () => {
  // Write a sample file directly to disk (no HTTP save -> no gestures row), bypassing sync.
  const label = 'zz_listcat_nodbrow'; // contains "_" -> heuristic "phrase"
  const dir = path.join(repo, 'saved_gestures', label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sample_1.json'), JSON.stringify({
    label, createdAt: new Date().toISOString(), frameCount: 3,
    format: 'mediapipe_hands_landmarks_v2', signLanguage: 'ESL', frames: fixtureFrames(3),
  }));

  // Confirm no DB row exists for this label.
  const rows = query(`SELECT id FROM gestures WHERE label = '${label}'`);
  assert.equal(rows.length, 0, 'precondition: no gestures row for this label');

  const noSync = callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false });
  assert.equal(noSync.categories.ESL[label], 'phrase');
});

test('the gestures part of the response is unchanged in shape (same keys per sample)', () => {
  post('zz_listcat_number', { category: 'number' });
  const r = callEndpoint({ method: 'GET', query: 'no_sync=1', stub: false });
  const sample = r.gestures['zz_listcat_number'][0];
  assert.deepEqual(
    Object.keys(sample).sort(),
    ['createdAt', 'file', 'frameCount', 'frames', 'label', 'signLanguage'].sort()
  );
});
