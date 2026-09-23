// Live-DB tests (via php-cgi, same harness as tests/multi-sample) for the category column added
// to `gestures` by this task: the ALTER/backfill in ensure_gestures_columns(), the upsert behaviour
// in save_gesture_word_to_db(), the POST save path's category handling, and disk-sync interaction.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { callEndpoint, fixtureFrames, repo } from '../multi-sample/harness.mjs';
import { query, exec } from './db.mjs';
import fs from 'node:fs';
import path from 'node:path';

// All probe labels created through the HTTP path (POST/GET) in this file. Cleaned before and
// after every test so tests don't see each other's leftovers.
const HTTP_LABELS = [
  'zz_cat_word1', 'zz_cat_letter1', 'zz_cat_number1', 'zz_cat_phrase1',
  'zz_cat_probe', 'zz_cat_bogus', 'zz_cat_retag', 'zz_cat_syncmanual', 'zz_cat_syncheuristic',
  'zz_cat_bf_trigger',
];
// Labels inserted directly via SQL for the backfill test (never touch disk).
const BACKFILL_LABELS = ['zz_cat_bf_one', 'zz_cat_bf_two', 'zz_cat_bf_three'];

function cleanupLabel(label) {
  callEndpoint({ body: { action: 'delete_gesture', label }, stub: false });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm']) {
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${label}.${ext}`), { force: true });
  }
}

function cleanupAll() {
  for (const l of HTTP_LABELS) cleanupLabel(l);
  if (BACKFILL_LABELS.length) {
    const list = BACKFILL_LABELS.map(l => `'${l}'`).join(',');
    exec(`DELETE FROM gestures WHERE word IN (${list})`);
  }
}

function post(label, extra = {}) {
  return callEndpoint({ body: { label, sign_language: 'ESL', frames: fixtureFrames(3), ...extra } });
}

function gestureRow(label) {
  const rows = query(`SELECT category FROM gestures WHERE word = '${label}' AND sign_language = 'ESL' LIMIT 1`);
  return rows[0] || null;
}

beforeEach(cleanupAll);
after(cleanupAll);

test('POST with an explicit category stores exactly that category, for all four categories', () => {
  const cases = [
    ['zz_cat_word1', 'word'],
    ['zz_cat_letter1', 'letter'],
    ['zz_cat_number1', 'number'],
    ['zz_cat_phrase1', 'phrase'],
  ];
  for (const [label, category] of cases) {
    const r = post(label, { category });
    assert.equal(r.success, true, `save of ${label} should succeed`);
    assert.equal(r.category, category, `response category for ${label}`);
    const row = gestureRow(label);
    assert.ok(row, `gestures row for ${label} should exist`);
    assert.equal(row.category, category, `stored category for ${label}`);
  }
});

test('POST with no category falls back to the heuristic (label contains "_" -> phrase)', () => {
  const r = post('zz_cat_probe');
  assert.equal(r.success, true);
  assert.equal(r.category, 'phrase');
  assert.equal(gestureRow('zz_cat_probe').category, 'phrase');
});

test('POST with an invalid category succeeds and falls back to the heuristic', () => {
  const r = post('zz_cat_bogus', { category: 'bogus' });
  assert.equal(r.success, true);
  assert.equal(r.category, 'phrase'); // zz_cat_bogus contains "_" -> phrase
  assert.equal(gestureRow('zz_cat_bogus').category, 'phrase');
});

test('re-tagging: a later POST with a different category overwrites; a POST with no category leaves it unchanged', () => {
  let r = post('zz_cat_retag', { category: 'word' });
  assert.equal(r.category, 'word');
  assert.equal(gestureRow('zz_cat_retag').category, 'word');

  r = post('zz_cat_retag', { category: 'number' });
  assert.equal(r.category, 'number');
  assert.equal(gestureRow('zz_cat_retag').category, 'number');

  r = post('zz_cat_retag'); // no category this time
  assert.equal(r.category, 'number', 'unchanged when no category is sent');
  assert.equal(gestureRow('zz_cat_retag').category, 'number');
});

test('a full disk sync (GET without no_sync) keeps a manually-tagged category', () => {
  post('zz_cat_syncmanual', { category: 'letter' });
  assert.equal(gestureRow('zz_cat_syncmanual').category, 'letter');

  callEndpoint({ method: 'GET', stub: false }); // full sync, no no_sync
  assert.equal(gestureRow('zz_cat_syncmanual').category, 'letter', 'sync must not overwrite a manual tag');
});

test('a full disk sync recreates a deleted gestures row with the heuristic category', () => {
  post('zz_cat_syncheuristic'); // heuristic -> phrase (contains "_")
  assert.equal(gestureRow('zz_cat_syncheuristic').category, 'phrase');

  // Remove the DB trace (gestures row + its gesture_recordings row) via SQL, leaving the sample
  // file on disk. sync_disk_to_db() only re-inserts a gestures row when the sample's
  // gesture_recordings row (keyed by sample_path) is also missing -- deleting only `gestures`
  // and leaving a gesture_recordings row pointing at the (now gone) old id would make sync skip
  // the label entirely, since its "already synced" check is keyed off gesture_recordings, not
  // gestures. This matches the real scenario the phase's own notes describe: disk is the source
  // of truth and sync recreates rows for anything not yet reflected in the DB.
  exec(`DELETE FROM gestures WHERE word = 'zz_cat_syncheuristic' AND sign_language = 'ESL'`);
  exec(`DELETE FROM gesture_recordings WHERE gesture_type = 'zz_cat_syncheuristic' AND sign_language = 'ESL'`);
  assert.equal(gestureRow('zz_cat_syncheuristic'), null);

  callEndpoint({ method: 'GET', stub: false }); // full sync recreates it from disk
  const row = gestureRow('zz_cat_syncheuristic');
  assert.ok(row, 'row should be recreated by sync');
  assert.equal(row.category, 'phrase');
});

test('backfill_gesture_categories sets every existing row to its heuristic category when the column is (re-)added', () => {
  // Simulate the pre-migration state: no category column, plain rows for our probes.
  const hadColumn = query("SHOW COLUMNS FROM gestures LIKE 'category'").length > 0;
  if (hadColumn) {
    exec('ALTER TABLE gestures DROP COLUMN category');
  }

  for (const label of BACKFILL_LABELS) {
    exec(`INSERT INTO gestures (word, sign_language) VALUES ('${label}', 'ESL')`);
  }

  // Any save that runs save_gesture_word_to_db() calls ensure_gestures_columns() first; it will
  // detect the missing column, add it, and backfill every pre-existing row (our probes included)
  // in that same call -- before the trigger label's own row is inserted.
  post('zz_cat_bf_trigger');

  for (const label of BACKFILL_LABELS) {
    const row = gestureRow(label);
    assert.ok(row, `backfilled row for ${label} should exist`);
    // All BACKFILL_LABELS contain "_" (from the zz_ prefix), so the heuristic is "phrase" for
    // every one of them here -- still a non-"word" result, which is what backfill must produce
    // instead of leaving the column's DEFAULT 'word'.
    assert.equal(row.category, 'phrase', `backfilled category for ${label}`);
  }

  const cols = query("SHOW COLUMNS FROM gestures LIKE 'category'");
  assert.equal(cols.length, 1, 'category column should exist after this test');
  assert.match(cols[0].Type, /^enum\(/i);
});
