// Live-DB tests (via php-cgi, same harness as tests/multi-sample) for the category column added
// to `gestures` by this task: the ALTER/backfill in ensure_gestures_columns(), the upsert behaviour
// in save_gesture_word_to_db(), the POST save path's category handling, and disk-sync interaction.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { callEndpoint, fixtureFrames, repo } from '../multi-sample/harness.mjs';
import { query, exec, callPhp } from './db.mjs';
import fs from 'node:fs';
import path from 'node:path';

// All probe labels created through the HTTP path (POST/GET) in this file. Cleaned before and
// after every test so tests don't see each other's leftovers.
const HTTP_LABELS = [
  'zz_cat_word1', 'zz_cat_letter1', 'zz_cat_number1', 'zz_cat_phrase1',
  'zz_cat_probe', 'zz_cat_bogus', 'zz_cat_retag', 'zz_cat_syncmanual', 'zz_cat_syncheuristic',
];

// Scratch table for the backfill test below -- never the real `gestures` table. Dropped before,
// after (and in a finally inside the test) so a failed run never leaves it behind.
const SCRATCH_TABLE = 'zz_cat_bf_gestures';
function dropScratchTable() {
  exec(`DROP TABLE IF EXISTS \`${SCRATCH_TABLE}\``);
}

// Guard against this suite ever touching a real (non-zz_) label's category again -- see the
// CRITICAL finding this file was rewritten for: a previous version of the backfill test above
// dropped and re-added the `category` column on the live `gestures` table, silently reverting any
// manual re-tag the owner had made. Snapshot every real row before the suite runs and assert it is
// byte-for-byte identical after, so a regression like that fails loudly instead of silently.
let realRowsBefore;
before(() => {
  realRowsBefore = query("SELECT word, sign_language, category FROM gestures WHERE word NOT LIKE 'zz%' ORDER BY sign_language, word");
});
after(() => {
  const realRowsAfter = query("SELECT word, sign_language, category FROM gestures WHERE word NOT LIKE 'zz%' ORDER BY sign_language, word");
  assert.deepEqual(realRowsAfter, realRowsBefore, 'no real gesture row\'s category may change from running this suite');
});

function cleanupLabel(label) {
  callEndpoint({ body: { action: 'delete_gesture', label }, stub: false });
  for (const sub of ['en', 'fil']) for (const ext of ['mp4', 'webm']) {
    fs.rmSync(path.join(repo, 'assets', 'signs', sub, `${label}.${ext}`), { force: true });
  }
}

function cleanupAll() {
  for (const l of HTTP_LABELS) cleanupLabel(l);
  dropScratchTable();
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

// Calls ensure_gestures_columns($conn, $table) once via PHP CLI against the live DB. Never
// requires save_gesture.php itself (which runs request-handling code at top level) -- only
// php/connect.php (for $conn) and php/api/gesture_category.php (which now holds
// ensure_gestures_columns()/backfill_gesture_categories(), pulled out specifically so this is
// possible). Defines a throwing fail() so a genuine failure surfaces as a thrown Node error
// instead of the real fail()'s http_response_code()/exit (undefined outside a web request).
function ensureGesturesColumns(table) {
  const gestureCategoryPhp = path.join(repo, 'php', 'api', 'gesture_category.php');
  const code = `
    function fail($message, $code = 400) { throw new Exception('fail(' . $code . '): ' . $message); }
    require ${JSON.stringify(gestureCategoryPhp)};
    ensure_gestures_columns($conn, ${JSON.stringify(table)});
    echo json_encode(['ok' => true]);
  `;
  return callPhp(path.join(repo, 'php', 'connect.php'), code);
}

test('backfill_gesture_categories sets every existing row to its heuristic category when the column is (re-)added', () => {
  dropScratchTable();
  try {
    // Pre-migration shape: no `category` column yet, one row per heuristic outcome.
    exec(`
      CREATE TABLE \`${SCRATCH_TABLE}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        word VARCHAR(255) NOT NULL,
        sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (word, sign_language)
      )
    `);
    const seed = [
      ['hello', 'word'],
      ['a', 'letter'],
      ['seven', 'number'],
      ['isa', 'number'],
      ['how_are_you', 'phrase'],
      ['42', 'number'],
    ];
    for (const [word] of seed) {
      exec(`INSERT INTO \`${SCRATCH_TABLE}\` (word, sign_language) VALUES ('${word}', 'ESL')`);
    }

    ensureGesturesColumns(SCRATCH_TABLE);

    const cols = query(`SHOW COLUMNS FROM \`${SCRATCH_TABLE}\` LIKE 'category'`);
    assert.equal(cols.length, 1, 'category column should have been added');
    assert.match(cols[0].Type, /^enum\(/i);
    assert.equal(cols[0].Default, 'word');

    for (const [word, expected] of seed) {
      const rows = query(`SELECT category FROM \`${SCRATCH_TABLE}\` WHERE word = '${word}'`);
      assert.equal(rows[0].category, expected, `backfilled category for '${word}'`);
    }

    // Manually re-tag one row (simulating the owner's own re-tag), then call ensure again: the
    // column already exists, so this must NOT re-run the backfill and revert the manual tag.
    exec(`UPDATE \`${SCRATCH_TABLE}\` SET category = 'phrase' WHERE word = 'hello'`);
    ensureGesturesColumns(SCRATCH_TABLE);
    const helloRow = query(`SELECT category FROM \`${SCRATCH_TABLE}\` WHERE word = 'hello'`);
    assert.equal(helloRow[0].category, 'phrase', 'a second ensure call must not re-run the backfill');
  } finally {
    dropScratchTable();
  }
});
