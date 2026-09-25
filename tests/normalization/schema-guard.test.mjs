// Regression guards for two owner non-negotiables from the DB-normalization phase
// (see .git/sdd/norm-shared-context.md, "Global Constraints"):
//   1. The disk-to-DB sync (sync_disk_to_db() in php/api/save_gesture.php, run on every GET
//      without ?no_sync) must not recreate the dropped tables (esl_signs/fsl_signs) or the
//      dropped columns (gestures.word; gesture_recordings.gesture_type/sign_language/
//      sample_count/thumbnail), and the gesture_recordings -> gestures FK must survive it.
//   2. asset_path on POST: the first POST with a video for a new (label, sign_language) sets
//      gestures.asset_path to the response's videoAsset; a second POST without video for the
//      same label must not clear/change it; both recordings must land under the SAME gestures
//      row (one gestures row, two gesture_recordings rows).
//
// Runs against the LIVE DB via the same harness as tests/multi-sample and tests/categorization.
// Uses a zz-prefixed probe label and cleans up fully (disk folder, DB rows via delete_gesture,
// and any assets/signs/<en|fil>/<label>.{mp4,webm} it created) in beforeEach/after.
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callEndpoint, fixtureFrames, fixtureVideo, repo } from '../multi-sample/harness.mjs';
import { query } from '../categorization/db.mjs';

const LABEL = 'zz_schemaguard_probe';
const EXPECTED_TABLES = ['conversations', 'gesture_recordings', 'gestures', 'messages', 'translations', 'users'];

function cleanupProbe() {
  callEndpoint({ body: { action: 'delete_gesture', label: LABEL }, stub: false });
  fs.rmSync(path.join(repo, 'saved_gestures', LABEL), { recursive: true, force: true });
  fs.rmSync(path.join(repo, 'saved_gestures_fsl', LABEL), { recursive: true, force: true });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm']) {
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${LABEL}.${ext}`), { force: true });
  }
}

beforeEach(cleanupProbe);
after(cleanupProbe);

function showTables() {
  return query('SHOW TABLES').map(r => Object.values(r)[0]).sort();
}

function columnsOf(table) {
  return query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
  ).map(r => r.COLUMN_NAME);
}

function fkExists() {
  return query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gesture_recordings'
       AND CONSTRAINT_NAME = 'fk_gesture_recordings_gesture' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`
  ).length === 1;
}

function assertSyncedSchemaIntact() {
  assert.deepEqual(showTables(), EXPECTED_TABLES.slice().sort(),
    'SHOW TABLES must be exactly {conversations, gesture_recordings, gestures, messages, translations, users} after a sync');

  const gestureCols = columnsOf('gestures');
  assert.equal(gestureCols.includes('word'), false, 'gestures.word must not be recreated by the sync');

  const recordingCols = columnsOf('gesture_recordings');
  for (const dropped of ['gesture_type', 'sign_language', 'sample_count', 'thumbnail']) {
    assert.equal(recordingCols.includes(dropped), false,
      `gesture_recordings.${dropped} must not be recreated by the sync`);
  }

  assert.equal(fkExists(), true, 'fk_gesture_recordings_gesture must survive the sync');
}

// ── 1a. Disk-to-DB sync must not recreate dropped tables/columns ───────────────────────────
test('a full-sync GET does not recreate dropped tables or dropped columns, and the FK survives', () => {
  const r = callEndpoint({ method: 'GET', stub: false }); // no query -- full sync path (no ?no_sync)
  assert.equal(r.success !== false, true, 'sync GET should not report failure');
  assertSyncedSchemaIntact();
});

test('a POST save (which also triggers the sync path indirectly via save_gesture_word_to_db) leaves schema intact', () => {
  const r = callEndpoint({ body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3) } });
  assert.equal(r.success, true, 'probe POST should succeed');
  assertSyncedSchemaIntact();
});

// ── 1b. asset_path on POST ──────────────────────────────────────────────────────────────────
test('asset_path is set from the first video POST, survives a second video-less POST, and both recordings share one gestures row', () => {
  const first = callEndpoint({
    body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3), video_base64: fixtureVideo() },
  });
  assert.equal(first.success, true);
  assert.ok(first.videoAsset, 'first POST with video must report a videoAsset');

  const afterFirst = query(
    `SELECT id, asset_path FROM gestures WHERE label = '${LABEL}' AND sign_language = 'ESL' LIMIT 1`
  )[0];
  assert.ok(afterFirst, 'gestures row must exist after the first POST');
  assert.equal(afterFirst.asset_path, first.videoAsset,
    'gestures.asset_path must equal the first POST\'s videoAsset');
  assert.notEqual(afterFirst.asset_path, null);

  const second = callEndpoint({
    body: { label: LABEL, sign_language: 'ESL', frames: fixtureFrames(3) }, // no video_base64
  });
  assert.equal(second.success, true);

  const afterSecond = query(
    `SELECT id, asset_path FROM gestures WHERE label = '${LABEL}' AND sign_language = 'ESL' LIMIT 1`
  )[0];
  assert.equal(afterSecond.id, afterFirst.id, 'the second POST must reuse the same gestures row');
  assert.equal(afterSecond.asset_path, afterFirst.asset_path,
    'asset_path must be unchanged by a video-less POST');

  const recordings = query(`SELECT id FROM gesture_recordings WHERE gesture_id = ${afterFirst.id}`);
  assert.equal(recordings.length, 2, 'both recordings must land under the single gestures row');
});
