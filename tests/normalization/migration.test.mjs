// Tests for the one-time DB-normalization migration
// (db-schema/migrations/2026-09-24-normalize.php). Runs ONLY against
// disposable clone databases (sining_kamay_db_migtest*) restored from a real
// mysqldump of the live DB -- the live `sining_kamay_db` itself is never
// altered. A before/after snapshot of the live DB's SHOW TABLES / SHOW CREATE
// TABLE gestures asserts that at the end of this file, in a try/finally that
// runs independently of (and after) clone cleanup so a failing assertion
// earlier in the file can never skip either.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LIVE_DB, MIGRATION_SCRIPT, cloneLiveDb, dropDb, queryDb, runMigration, runUnderCgi,
  tmpSnapshotPath, postMigrationState, showCreateTable, normalizeDdl, tableList, columnExists,
} from './clone-helper.mjs';

const CLONE = 'sining_kamay_db_migtest';
const ALL_CLONES = new Set();

function clone(suffix) {
  const name = suffix ? `${CLONE}_${suffix}` : CLONE;
  ALL_CLONES.add(name);
  cloneLiveDb(name);
  return name;
}

// Every test that needs a clone (and usually a snapshot file) goes through this so cleanup runs in
// a finally block even when the test's own assertions throw -- required so a failing test never
// leaves a sining_kamay_db_migtest* database or a temp snapshot file behind.
function withCloneAndSnapshot(suffix, fn) {
  const db = clone(suffix);
  const snapshot = tmpSnapshotPath(suffix);
  try {
    fn(db, snapshot);
  } finally {
    fs.rmSync(snapshot, { force: true });
    dropDb(db);
    ALL_CLONES.delete(db);
  }
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

function pickOneId(dbName, table) {
  return queryDb(dbName, `SELECT id FROM \`${table}\` ORDER BY id LIMIT 1`)[0].id;
}

// ── CLI guard ──────────────────────────────────────────────────────────────
test('running the migration script under php-cgi (non-CLI) is refused with a 403 and no body, and changes nothing', () => {
  const before = queryDb(LIVE_DB, 'SHOW TABLES');
  const r = runUnderCgi(MIGRATION_SCRIPT);
  assert.match(r.stdout, /Status:\s*403/);
  const headerEnd = r.stdout.indexOf('\r\n\r\n');
  assert.ok(headerEnd >= 0, 'expected a CRLFCRLF header/body separator in the CGI response; got:\n' + r.stdout);
  const body = r.stdout.slice(headerEnd + 4);
  assert.equal(body.trim(), '');
  const after = queryDb(LIVE_DB, 'SHOW TABLES');
  assert.deepEqual(after, before);
});

// ── Full run on a clone ─────────────────────────────────────────────────────
let referenceState; // captured from the first full, uninterrupted run; reused by the interruption tests

test('full run on a clone: exits 0 and produces the exact target schema/data', () => {
  withCloneAndSnapshot('full', (db, snapshot) => {
    const preRecordingCounts = queryDb(db,
      "SELECT g.word AS label, g.sign_language, COUNT(*) AS c FROM gesture_recordings gr JOIN gestures g ON g.id = gr.gesture_id GROUP BY g.word, g.sign_language");
    const preAssetInfo = queryDb(db, `
      SELECT g.word AS label, g.sign_language,
             COALESCE(es.asset_path, fs.asset_path) AS asset_path,
             COALESCE(es.is_active, fs.is_active) AS is_active
      FROM gestures g
      LEFT JOIN esl_signs es ON g.sign_language='ESL' AND es.sign_key = g.word
      LEFT JOIN fsl_signs fs ON g.sign_language='FSL' AND fs.sign_key = g.word`);

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

    referenceState = postMigrationState(db);
  });
});

// ── Re-run is a no-op ───────────────────────────────────────────────────────
test('re-running the migration on an already-migrated clone: exit 0, every step "already done", data unchanged', () => {
  withCloneAndSnapshot('rerun', (db, snapshot) => {
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
  });
});

// ── Interruption / resume ───────────────────────────────────────────────────
test('interrupting after any step N (1..9) and resuming reaches the same final state as an uninterrupted run', () => {
  assert.ok(referenceState, 'reference state must have been captured by the full-run test');
  for (let n = 1; n <= 9; n++) {
    withCloneAndSnapshot(`stop${n}`, (db, snapshot) => {
      const partial = runMigration(db, [`--stop-after=${n}`], { snapshotPath: snapshot });
      assert.equal(partial.status, 0, `--stop-after=${n} should exit 0; stderr:\n${partial.stderr}`);
      assert.match(partial.stdout, new RegExp(`step ${n} `), `--stop-after=${n} should have run step ${n}`);
      assert.doesNotMatch(partial.stdout, new RegExp(`step ${n + 1} `), `--stop-after=${n} must not start step ${n + 1}`);

      const resumed = runMigration(db, [], { snapshotPath: snapshot });
      assert.equal(resumed.status, 0, `resuming after stop-after=${n} should exit 0; stderr:\n${resumed.stderr}`);
      assertFullyMigrated(db);
      assert.deepEqual(postMigrationState(db), referenceState, `final state after interrupting at step ${n} must match the reference run`);
    });
  }
});

// ── Failed precondition aborts before any drop (step 4) ─────────────────────
test('an orphaned recording aborts at step 4 before esl_signs/fsl_signs are touched', () => {
  withCloneAndSnapshot('orphan', (db, snapshot) => {
    queryDb(db, `INSERT INTO gesture_recordings (gesture_id, sign_language, gesture_type, sample_count, sample_path, recorded_at)
                 VALUES (999999999, 'ESL', 'zz_orphan', 1, 'zz_orphan_probe.json', NOW())`);
    const r = runMigration(db, [], { snapshotPath: snapshot });
    assert.notEqual(r.status, 0, 'migration must fail when an orphaned recording exists');
    assert.match(r.stdout + r.stderr, /step 4/i);
    assert.doesNotMatch(r.stdout, /step 5/i);
    assert.equal(tableList(db).includes('esl_signs'), true, 'esl_signs must still exist after the abort');
    assert.equal(tableList(db).includes('fsl_signs'), true, 'fsl_signs must still exist after the abort');
  });
});

// ── Step 7/10 comparison actually catches mutated data (review round 1, item 1a) ──
const MUTATIONS = [
  {
    tag: 'category',
    label: "a gesture's category changes after --stop-after=6",
    mutate: db => {
      const id = pickOneId(db, 'gestures');
      queryDb(db, `UPDATE gestures SET category = IF(category = 'letter', 'word', 'letter') WHERE id = ${id}`);
    },
  },
  {
    tag: 'delete',
    label: 'a recording is deleted after --stop-after=6',
    mutate: db => {
      const id = pickOneId(db, 'gesture_recordings');
      queryDb(db, `DELETE FROM gesture_recordings WHERE id = ${id}`);
    },
  },
  {
    tag: 'landmark',
    label: "a recording's landmark_json changes after --stop-after=6",
    mutate: db => {
      const id = pickOneId(db, 'gesture_recordings');
      queryDb(db, `UPDATE gesture_recordings SET landmark_json = CONCAT(COALESCE(landmark_json, ''), 'X') WHERE id = ${id}`);
    },
  },
];

for (const { tag, label, mutate } of MUTATIONS) {
  test(`step 7 verify-before-drop catches it and aborts when ${label}`, () => {
    withCloneAndSnapshot(`mut_${tag}`, (db, snapshot) => {
      const partial = runMigration(db, ['--stop-after=6'], { snapshotPath: snapshot });
      assert.equal(partial.status, 0, `--stop-after=6 should exit 0; stderr:\n${partial.stderr}`);

      mutate(db);

      const resumed = runMigration(db, [], { snapshotPath: snapshot });
      assert.notEqual(resumed.status, 0, 'mutated data must cause a non-zero exit at step 7');
      assert.match(resumed.stderr, /step 7/i, `stderr should mention step 7; got:\n${resumed.stderr}`);
      assert.doesNotMatch(resumed.stdout, /step 8/i, 'step 8 must never start once step 7 finds a mismatch');
      assert.equal(tableList(db).includes('esl_signs'), true, 'esl_signs must still exist after the abort');
      assert.equal(columnExists(db, 'gesture_recordings', 'gesture_type'), true, 'gesture_type must still exist after the abort');
    });
  });
}

// ── Resuming with the snapshot deleted aborts instead of silently skipping verification (item 1b) ──
test('resuming after --stop-after=6 with the snapshot file deleted aborts and drops nothing', () => {
  withCloneAndSnapshot('nosnap', (db, snapshot) => {
    const partial = runMigration(db, ['--stop-after=6'], { snapshotPath: snapshot });
    assert.equal(partial.status, 0, `--stop-after=6 should exit 0; stderr:\n${partial.stderr}`);

    fs.rmSync(snapshot, { force: true });

    const resumed = runMigration(db, [], { snapshotPath: snapshot });
    assert.notEqual(resumed.status, 0, 'resuming with no snapshot file and a partially-migrated DB must fail, not silently proceed');
    assert.equal(tableList(db).includes('esl_signs'), true, 'esl_signs must still exist after the abort');
    assert.equal(columnExists(db, 'gesture_recordings', 'gesture_type'), true, 'gesture_type must still exist after the abort');
  });
});

// ── --verify-only (review round 1, item 8) ──────────────────────────────────
test('--verify-only on a fully migrated clone: exit 0, "0 differences" + SHOW CREATE TABLE, changes nothing', () => {
  withCloneAndSnapshot('vo_ok', (db, snapshot) => {
    const full = runMigration(db, [], { snapshotPath: snapshot });
    assert.equal(full.status, 0, full.stderr);

    const before = postMigrationState(db);
    const ddlBefore = { g: showCreateTable(db, 'gestures'), r: showCreateTable(db, 'gesture_recordings') };

    const vo = runMigration(db, ['--verify-only'], { snapshotPath: snapshot });
    assert.equal(vo.status, 0, `--verify-only should exit 0 on an untouched, fully-migrated clone; stderr:\n${vo.stderr}`);
    assert.match(vo.stdout, /0 differences/);
    assert.match(vo.stdout, /SHOW CREATE TABLE/);

    assert.deepEqual(postMigrationState(db), before, '--verify-only must not change any data');
    assert.equal(showCreateTable(db, 'gestures'), ddlBefore.g, '--verify-only must not change the gestures schema');
    assert.equal(showCreateTable(db, 'gesture_recordings'), ddlBefore.r, '--verify-only must not change the gesture_recordings schema');
  });
});

test('--verify-only on a clone mutated after migration: exits non-zero', () => {
  withCloneAndSnapshot('vo_bad', (db, snapshot) => {
    const full = runMigration(db, [], { snapshotPath: snapshot });
    assert.equal(full.status, 0, full.stderr);

    const id = pickOneId(db, 'gestures');
    queryDb(db, `UPDATE gestures SET category = IF(category = 'letter', 'word', 'letter') WHERE id = ${id}`);

    const vo = runMigration(db, ['--verify-only'], { snapshotPath: snapshot });
    assert.notEqual(vo.status, 0, '--verify-only must fail once the post-migration data no longer matches the snapshot');
  });
});

// ── Step 2 must report "done" (not "already done") when a resume actually fixes stale data (item 7) ──
test('step 2 reports "done" when resuming re-copies a value that had gone stale, not "already done"', () => {
  withCloneAndSnapshot('backfill', (db, snapshot) => {
    const partial = runMigration(db, ['--stop-after=2'], { snapshotPath: snapshot });
    assert.equal(partial.status, 0, `--stop-after=2 should exit 0; stderr:\n${partial.stderr}`);

    // Simulate a crash between step 2's ADD COLUMN and its backfill UPDATE actually taking effect:
    // corrupt one already-backfilled gesture's asset_path. esl_signs/fsl_signs are still present at
    // this point (step 9 hasn't run), so a resumed step 2 has a real source to re-copy from.
    const row = queryDb(db, "SELECT id FROM gestures WHERE sign_language = 'ESL' LIMIT 1")[0];
    queryDb(db, `UPDATE gestures SET asset_path = 'zz_stale_probe.webm' WHERE id = ${row.id}`);

    const resumed = runMigration(db, [], { snapshotPath: snapshot });
    assert.equal(resumed.status, 0, `resuming should succeed once step 2 re-backfills the corrupted row; stderr:\n${resumed.stderr}`);
    assert.match(resumed.stdout, /step 2 add-gesture-columns: done/,
      'step 2 must report "done" (it actually changed a row), not "already done"');
  });
});

// ── Safety net: the live DB is never touched by any test above ─────────────
let liveTablesBefore, liveGesturesDdlBefore;
before(() => {
  liveTablesBefore = queryDb(LIVE_DB, 'SHOW TABLES');
  liveGesturesDdlBefore = showCreateTable(LIVE_DB, 'gestures');
});
after(() => {
  try {
    for (const name of ALL_CLONES) dropDb(name);
    ALL_CLONES.clear();
  } finally {
    const liveTablesAfter = queryDb(LIVE_DB, 'SHOW TABLES');
    const liveGesturesDdlAfter = showCreateTable(LIVE_DB, 'gestures');
    assert.deepEqual(liveTablesAfter, liveTablesBefore, 'live DB table list must be unchanged by this test file');
    assert.equal(liveGesturesDdlAfter, liveGesturesDdlBefore, 'live DB gestures DDL must be unchanged by this test file');
  }
});
