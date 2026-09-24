// Tests for the one-time DB-normalization migration
// (db-schema/migrations/2026-09-24-normalize.php). Runs ONLY against
// disposable clone databases (sining_kamay_db_migtest*) restored from a real
// mysqldump of the live DB -- the live `sining_kamay_db` itself is never
// altered. A before/after snapshot of the live DB's SHOW TABLES / SHOW CREATE
// TABLE gestures asserts that at the end of this file.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIVE_DB, MIGRATION_SCRIPT, cloneLiveDb, dropDb, queryDb, runMigration, runUnderCgi,
  tmpSnapshotPath, postMigrationState, showCreateTable, normalizeDdl, tableList,
} from './clone-helper.mjs';

const CLONE = 'sining_kamay_db_migtest';
const ALL_CLONES = new Set();

function clone(suffix) {
  const name = suffix ? `${CLONE}_${suffix}` : CLONE;
  ALL_CLONES.add(name);
  cloneLiveDb(name);
  return name;
}

const TARGET_GESTURES_DDL = normalizeDdl(`CREATE TABLE \`gestures\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`label\` varchar(255) NOT NULL,
  \`sign_language\` enum('ESL','FSL') NOT NULL DEFAULT 'ESL',
  \`category\` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  \`asset_path\` varchar(255) DEFAULT NULL,
  \`is_active\` tinyint(1) NOT NULL DEFAULT 1,
  \`created_at\` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_gestures_label_language\` (\`label\`,\`sign_language\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);

const TARGET_RECORDINGS_DDL = normalizeDdl(`CREATE TABLE \`gesture_recordings\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`gesture_id\` int(11) NOT NULL,
  \`frame_count\` int(11) NOT NULL DEFAULT 0,
  \`sample_path\` varchar(255) NOT NULL,
  \`landmark_json\` longtext DEFAULT NULL,
  \`recorded_at\` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_gesture_recordings_sample_path\` (\`sample_path\`),
  KEY \`idx_gesture_recordings_gesture\` (\`gesture_id\`),
  CONSTRAINT \`fk_gesture_recordings_gesture\` FOREIGN KEY (\`gesture_id\`) REFERENCES \`gestures\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
// Note: MariaDB's SHOW CREATE TABLE omits "ON DELETE RESTRICT" because RESTRICT is the implicit
// default for a FK with no ON DELETE clause -- verified separately below via
// information_schema.REFERENTIAL_CONSTRAINTS.DELETE_RULE.

function assertFullyMigrated(dbName) {
  assert.deepEqual(tableList(dbName).slice().sort(), ['gesture_recordings', 'gestures', 'translations', 'users'].sort());
  assert.equal(normalizeDdl(showCreateTable(dbName, 'gestures')), TARGET_GESTURES_DDL);
  assert.equal(normalizeDdl(showCreateTable(dbName, 'gesture_recordings')), TARGET_RECORDINGS_DDL);

  const counts = queryDb(dbName, 'SELECT (SELECT COUNT(*) FROM gestures) AS g, (SELECT COUNT(*) FROM gesture_recordings) AS r')[0];
  assert.equal(Number(counts.g), 209);
  assert.equal(Number(counts.r), 210);

  const orphans = queryDb(dbName,
    'SELECT COUNT(*) AS c FROM gesture_recordings gr LEFT JOIN gestures g ON g.id = gr.gesture_id WHERE g.id IS NULL')[0];
  assert.equal(Number(orphans.c), 0);

  const catSplit = queryDb(dbName, 'SELECT sign_language, category, COUNT(*) AS c FROM gestures GROUP BY sign_language, category');
  const bySl = {};
  for (const row of catSplit) { (bySl[row.sign_language] ??= {})[row.category] = Number(row.c); }
  assert.deepEqual(bySl.ESL, { word: 67, letter: 26, number: 10, phrase: 17 });
  assert.deepEqual(bySl.FSL, { word: 50, number: 10, phrase: 29 });

  const fk = queryDb(dbName,
    `SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA='${dbName}' AND TABLE_NAME='gesture_recordings' AND CONSTRAINT_NAME='fk_gesture_recordings_gesture'`);
  assert.equal(fk.length, 1, 'FK fk_gesture_recordings_gesture must exist');
  assert.equal(fk[0].DELETE_RULE, 'RESTRICT');
}

// ── CLI guard ──────────────────────────────────────────────────────────────
test('running the migration script under php-cgi (non-CLI) is refused with a 403 and no body, and changes nothing', () => {
  const before = queryDb(LIVE_DB, 'SHOW TABLES');
  const r = runUnderCgi(MIGRATION_SCRIPT);
  assert.match(r.stdout, /Status:\s*403/);
  const headerEnd = r.stdout.indexOf('\r\n\r\n');
  const body = headerEnd >= 0 ? r.stdout.slice(headerEnd + 4) : '';
  assert.equal(body.trim(), '');
  const after = queryDb(LIVE_DB, 'SHOW TABLES');
  assert.deepEqual(after, before);
});

// ── Full run on a clone ─────────────────────────────────────────────────────
let referenceState; // captured from the first full, uninterrupted run; reused by the interruption tests

test('full run on a clone: exits 0 and produces the exact target schema/data', () => {
  const db = clone('full');
  const preRecordingCounts = queryDb(db,
    "SELECT g.word AS label, g.sign_language, COUNT(*) AS c FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id GROUP BY g.word, g.sign_language");
  const preAssetInfo = queryDb(db, `
    SELECT g.word AS label, g.sign_language,
           COALESCE(es.asset_path, fs.asset_path) AS asset_path,
           COALESCE(es.is_active, fs.is_active) AS is_active
    FROM gestures g
    LEFT JOIN esl_signs es ON g.sign_language='ESL' AND es.sign_key = g.word
    LEFT JOIN fsl_signs fs ON g.sign_language='FSL' AND fs.sign_key = g.word`);

  const snapshot = tmpSnapshotPath('full');
  const r = runMigration(db, [], { snapshotPath: snapshot });
  assert.equal(r.status, 0, `migration should exit 0; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`);
  assert.match(r.stdout, /step 10 final-verify: done/);

  assertFullyMigrated(db);

  const postRecordingCounts = queryDb(db,
    'SELECT label, sign_language, COUNT(*) AS c FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id GROUP BY label, sign_language');
  const keyOf = r => `${r.label}\u0001${r.sign_language}`;
  const preMap = new Map(preRecordingCounts.map(r => [keyOf(r), Number(r.c)]));
  const postMap = new Map(postRecordingCounts.map(r => [keyOf(r), Number(r.c)]));
  assert.deepEqual(postMap, preMap, 'per-(label,language) recording counts must be unchanged by the migration');

  const postAssetInfo = queryDb(db, 'SELECT label, sign_language, asset_path, is_active FROM gestures');
  const preAssetMap = new Map(preAssetInfo.map(r => [keyOf(r), `${r.asset_path}|${r.is_active}`]));
  for (const row of postAssetInfo) {
    const expected = preAssetMap.get(keyOf(row));
    assert.equal(`${row.asset_path}|${row.is_active}`, expected, `asset_path/is_active for ${keyOf(row)} must be preserved`);
  }

  fs.rmSync(snapshot, { force: true });
  referenceState = postMigrationState(db);
});

// ── Re-run is a no-op ───────────────────────────────────────────────────────
test('re-running the migration on an already-migrated clone: exit 0, every step "already done", data unchanged', () => {
  const db = clone('rerun');
  const snapshot = tmpSnapshotPath('rerun');
  const first = runMigration(db, [], { snapshotPath: snapshot });
  assert.equal(first.status, 0, first.stderr);
  const before = postMigrationState(db);

  const second = runMigration(db, [], { snapshotPath: snapshot });
  assert.equal(second.status, 0, second.stderr);
  for (let n = 1; n <= 10; n++) {
    assert.match(second.stdout, new RegExp(`step ${n} `), `step ${n} should still be reported`);
  }
  // Steps 2-6, 8, 9 are idempotent no-ops on a second run; 1, 7, 10 always act (snapshot reuse / verify).
  for (const n of [2, 3, 4, 5, 6, 8, 9]) {
    assert.match(second.stdout, new RegExp(`step ${n} [a-z-]+: already done`), `step ${n} should say already done on re-run`);
  }
  assert.match(second.stdout, /step 1 snapshot: already done/);

  assertFullyMigrated(db);
  const after = postMigrationState(db);
  assert.deepEqual(after, before, 'schema and data must be unchanged by a re-run');
  fs.rmSync(snapshot, { force: true });
});

// ── Interruption / resume ───────────────────────────────────────────────────
test('interrupting after any step N (1..9) and resuming reaches the same final state as an uninterrupted run', () => {
  assert.ok(referenceState, 'reference state must have been captured by the full-run test');
  for (let n = 1; n <= 9; n++) {
    const db = clone(`stop${n}`);
    const snapshot = tmpSnapshotPath(`stop${n}`);
    const partial = runMigration(db, [`--stop-after=${n}`], { snapshotPath: snapshot });
    assert.equal(partial.status, 0, `--stop-after=${n} should exit 0; stderr:\n${partial.stderr}`);
    assert.match(partial.stdout, new RegExp(`step ${n} `), `--stop-after=${n} should have run step ${n}`);
    assert.doesNotMatch(partial.stdout, new RegExp(`step ${n + 1} `), `--stop-after=${n} must not start step ${n + 1}`);

    const resumed = runMigration(db, [], { snapshotPath: snapshot });
    assert.equal(resumed.status, 0, `resuming after stop-after=${n} should exit 0; stderr:\n${resumed.stderr}`);
    assertFullyMigrated(db);
    assert.deepEqual(postMigrationState(db), referenceState, `final state after interrupting at step ${n} must match the reference run`);
    fs.rmSync(snapshot, { force: true });
  }
});

// ── Failed precondition aborts before any drop ──────────────────────────────
test('an orphaned recording aborts at step 4 before esl_signs/fsl_signs are touched', () => {
  const db = clone('orphan');
  queryDb(db, `INSERT INTO gesture_recordings (gesture_id, sign_language, gesture_type, sample_count, sample_path, recorded_at)
               VALUES (999999999, 'ESL', 'zz_orphan', 1, 'zz_orphan_probe.json', NOW())`);
  const snapshot = tmpSnapshotPath('orphan');
  const r = runMigration(db, [], { snapshotPath: snapshot });
  assert.notEqual(r.status, 0, 'migration must fail when an orphaned recording exists');
  assert.match(r.stdout + r.stderr, /step 4/i);
  assert.doesNotMatch(r.stdout, /step 5/i);
  assert.equal(tableList(db).includes('esl_signs'), true, 'esl_signs must still exist after the abort');
  assert.equal(tableList(db).includes('fsl_signs'), true, 'fsl_signs must still exist after the abort');
  fs.rmSync(snapshot, { force: true });
});

// ── Safety net: the live DB is never touched by any test above ─────────────
let liveTablesBefore, liveGesturesDdlBefore;
before(() => {
  liveTablesBefore = queryDb(LIVE_DB, 'SHOW TABLES');
  liveGesturesDdlBefore = showCreateTable(LIVE_DB, 'gestures');
});
after(() => {
  const liveTablesAfter = queryDb(LIVE_DB, 'SHOW TABLES');
  const liveGesturesDdlAfter = showCreateTable(LIVE_DB, 'gestures');
  assert.deepEqual(liveTablesAfter, liveTablesBefore, 'live DB table list must be unchanged by this test file');
  assert.equal(liveGesturesDdlAfter, liveGesturesDdlBefore, 'live DB gestures DDL must be unchanged by this test file');
  for (const name of ALL_CLONES) dropDb(name);
  ALL_CLONES.clear();
});
