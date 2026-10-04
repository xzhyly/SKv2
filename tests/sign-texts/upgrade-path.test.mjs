// In-place upgrade of a pre-"sign texts" database by ensure_gestures_columns() (php/api/gesture_category.php).
// Runs only against a disposable clone (sining_kamay_db_stupg) of the pre-phase dump; the live DB is
// never touched. The clone is queried/altered through PHP CLI with its own mysqli connection.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PHP, repo, mysqlCli } from '../normalization/clone-helper.mjs';
import { SOURCE_DUMP, SKIP_REASON, cloneFromDump, dropDb, queryDb } from './helper.mjs';

const DB = 'sining_kamay_db_stupg';
const opts = { skip: SKIP_REASON };
if (SKIP_REASON) console.log(`# SKIPPING upgrade-path tests: ${SKIP_REASON}`);

before(() => { if (!SKIP_REASON) dropDb(DB); });
after(() => { if (!SKIP_REASON) dropDb(DB); });

// Runs ensure_gestures_columns against the clone; returns { ok, error, queries } where queries is
// the number of information_schema statements the call issued.
function ensure() {
  const lib = path.join(repo, 'php', 'api', 'gesture_category.php');
  const code = `
    function fail($m, $c = 400) { throw new Exception('fail(' . $c . '): ' . $m); }
    mysqli_report(MYSQLI_REPORT_OFF);
    $conn = mysqli_connect('127.0.0.1', 'root', '', '${DB}');
    require ${JSON.stringify(lib)};
    try { ensure_gestures_columns($conn, 'gestures'); echo json_encode(['ok' => true]); }
    catch (Throwable $e) { echo json_encode(['ok' => false, 'error' => $e->getMessage()]); }
  `;
  const r = spawnSync(PHP, ['-r', code], { encoding: 'utf8', cwd: repo });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}
const ddl = () => queryDb(DB, 'SHOW CREATE TABLE gestures')[0]['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '');

test('upgrade: enum gains BOTH, key swaps, BOTH row stores BOTH, second call is a no-op', opts, () => {
  cloneFromDump(DB);
  assert.match(ddl(), /enum\('ESL','FSL'\)/i);
  assert.match(ddl(), /uq_gestures_label_language/);
  const before = ddl();
  assert.deepEqual(ensure(), { ok: true });
  const after1 = ddl();
  assert.match(after1, /enum\('ESL','FSL','BOTH'\)/i);
  assert.match(after1, /UNIQUE KEY `uq_gestures_label` \(`label`\)/);
  assert.doesNotMatch(after1, /uq_gestures_label_language/);
  assert.doesNotMatch(after1, /chk_gestures_texts/, 'CHECK is not added by ensure');
  mysqlCli(['-e', `INSERT INTO ${DB}.gestures (label, sign_language, text_en, text_fil) VALUES ('zz_upg_both','BOTH','Zz upg','Zz upg')`]);
  assert.equal(queryDb(DB, "SELECT sign_language FROM gestures WHERE label='zz_upg_both'")[0].sign_language, 'BOTH');
  assert.deepEqual(ensure(), { ok: true });
  assert.equal(ddl(), after1, 'second call changes nothing');
  assert.notEqual(before, after1);
});

test('upgrade: duplicate label leaves the old key in place without error; swaps once duplicates are gone', opts, () => {
  cloneFromDump(DB);
  const l = queryDb(DB, "SELECT label FROM gestures WHERE sign_language='ESL' LIMIT 1")[0].label;
  mysqlCli(['-e', `INSERT INTO ${DB}.gestures (label, sign_language) VALUES ('${l}','FSL')`]);
  assert.deepEqual(ensure(), { ok: true });
  let d = ddl();
  assert.match(d, /enum\('ESL','FSL','BOTH'\)/i, 'enum still widened');
  assert.match(d, /uq_gestures_label_language/, 'old key kept');
  assert.doesNotMatch(d, /UNIQUE KEY `uq_gestures_label` /);
  mysqlCli(['-e', `DELETE FROM ${DB}.gestures WHERE label='${l}' AND sign_language='FSL'`]);
  assert.deepEqual(ensure(), { ok: true });
  d = ddl();
  assert.match(d, /UNIQUE KEY `uq_gestures_label` \(`label`\)/);
  assert.doesNotMatch(d, /uq_gestures_label_language/);
});
