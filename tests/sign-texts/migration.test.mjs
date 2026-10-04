// Tests for the one-time "one sign, two texts" migration
// (db-schema/migrations/2026-10-04-sign-texts.php). Runs only against a disposable clone
// database (sining_kamay_db_sttest) restored from the pre-migration dump and against temp copies
// of the pre-migration dataset; the live DB and the repo's saved_gestures*/ are never touched.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CLONE_DB, SKIP_REASON, DATASET_COPY, cloneFromDump, dropDb, queryDb, makeWorkspace, runMigration,
  endState, sampleFiles, sha256,
} from './helper.mjs';

const workspaces = [];
function workspace(tag) { const ws = makeWorkspace(tag); workspaces.push(ws); return ws; }

if (SKIP_REASON) console.log(`# SKIPPING sign-texts migration tests: ${SKIP_REASON}`);

before(() => { if (!SKIP_REASON) dropDb(CLONE_DB); });
after(() => {
  if (!SKIP_REASON) dropDb(CLONE_DB);
  for (const ws of workspaces) fs.rmSync(ws.base, { recursive: true, force: true });
});

const opts = { skip: SKIP_REASON };
let reference = null; // end state of the uninterrupted run (case a)

function assertCompleteRun(db, ws, state) {
  const byLang = Object.fromEntries(
    queryDb(db, 'SELECT sign_language, COUNT(*) AS c FROM gestures GROUP BY sign_language').map(r => [r.sign_language, Number(r.c)]));
  assert.deepEqual(byLang, { BOTH: 89, ESL: 33 });
  assert.equal(queryDb(db, 'SELECT COUNT(*) AS c FROM gestures')[0].c, '122');
  assert.equal(queryDb(db, 'SELECT COUNT(*) AS c FROM gesture_recordings')[0].c, '127');
  assert.equal(state.manifest.length, 90);
  for (const e of state.manifest) {
    const orig = path.join(DATASET_COPY, e.source);
    assert.equal(e.sha256, sha256(orig), `manifest sha for ${e.source}`);
    assert.equal(sha256(path.join(ws.backup, e.backup)), sha256(orig), `backup bytes for ${e.source}`);
  }
  assert.deepEqual(state.fslFiles, []);
  assert.equal(state.backupFiles.length, 90);
  assert.equal(Object.keys(state.signs).length, 122);
  assert.deepEqual(state.signs.how_are_you, { key: 'how_are_you', set: 'BOTH', textEn: 'How are you', textFil: 'Kamusta ka' });
  assert.deepEqual(state.signs.a, { key: 'a', set: 'ESL', textEn: 'A', textFil: null });
  const row = queryDb(db, "SELECT sign_language, text_en, text_fil FROM gestures WHERE label='how_are_you'")[0];
  assert.deepEqual(row, { sign_language: 'BOTH', text_en: 'How are you', text_fil: 'Kamusta ka' });
  const a = queryDb(db, "SELECT sign_language, text_en, text_fil FROM gestures WHERE label='a'")[0];
  assert.deepEqual(a, { sign_language: 'ESL', text_en: 'A', text_fil: null });
  const ddl = queryDb(db, 'SHOW CREATE TABLE gestures')[0]['Create Table'];
  assert.match(ddl, /uq_gestures_label`/);
  assert.match(ddl, /chk_gestures_texts/);
  assert.doesNotMatch(ddl, /uq_gestures_label_language/);
  assert.equal(state.eslFiles.length, 127);
}

test('(a) full run reaches the expected end state; (b) second run is a no-op', opts, () => {
  cloneFromDump(CLONE_DB);
  const ws = workspace('full');
  const t0 = Date.now();
  const r = runMigration(CLONE_DB, ws);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Migration complete\./);
  const state = endState(CLONE_DB, ws);
  assertCompleteRun(CLONE_DB, ws, state);
  reference = state;
  console.log(`# full run: ${Date.now() - t0} ms`);

  const r2 = runMigration(CLONE_DB, ws);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  for (const n of [3, 4, 5, 6, 7]) assert.match(r2.stdout, new RegExp(`step ${n} [^\\n]*skipped`), `step ${n} skipped on re-run`);
  assert.deepEqual(endState(CLONE_DB, ws), state);

  const v = runMigration(CLONE_DB, ws, ['--verify-only']);
  assert.equal(v.status, 0, v.stderr + v.stdout);
  assert.match(v.stdout, /verify: all checks passed/);
});

for (let n = 1; n <= 7; n++) {
  test(`(c) interrupted after step ${n} then resumed converges to the same end state`, opts, () => {
    assert.ok(reference, 'case (a) must have produced a reference end state');
    cloneFromDump(CLONE_DB);
    const ws = workspace(`stop${n}`);
    const part = runMigration(CLONE_DB, ws, [`--stop-after=${n}`]);
    assert.equal(part.status, 0, part.stderr + part.stdout);
    assert.doesNotMatch(part.stdout, /Migration complete/);
    const full = runMigration(CLONE_DB, ws);
    assert.equal(full.status, 0, full.stderr + full.stdout);
    assert.deepEqual(endState(CLONE_DB, ws), reference);
  });
}

test('(c) crash after a file was copied and deleted but before the manifest write converges', opts, () => {
  assert.ok(reference, 'case (a) must have produced a reference end state');
  cloneFromDump(CLONE_DB);
  const ws = workspace('halfmove');
  assert.equal(runMigration(CLONE_DB, ws, ['--stop-after=4']).status, 0);
  const src = path.join(ws.root, 'saved_gestures_fsl', 'alam');
  const file = fs.readdirSync(src).find(f => f.startsWith('sample_'));
  const dest = path.join(ws.backup, 'saved_gestures_fsl', 'alam');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  fs.rmSync(src, { recursive: true });
  const full = runMigration(CLONE_DB, ws);
  assert.equal(full.status, 0, full.stderr + full.stdout);
  assert.deepEqual(endState(CLONE_DB, ws), reference);
});

test('(d) tampered FSL sample aborts at step 2 with nothing changed', opts, () => {
  cloneFromDump(CLONE_DB);
  const ws = workspace('tamper');
  const dir = path.join(ws.root, 'saved_gestures_fsl', 'kamusta');
  const file = path.join(dir, fs.readdirSync(dir).find(f => f.startsWith('sample_')));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.frames[0][3] += 1e-9;
  fs.writeFileSync(file, JSON.stringify(j));
  const filesBefore = sampleFiles(ws.root);
  const r = runMigration(CLONE_DB, ws);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pair not proven for saved_gestures_fsl\/kamusta\//);
  assert.doesNotMatch(r.stdout, /step 3/);
  assert.deepEqual(sampleFiles(ws.root), filesBefore, 'no sample file moved');
  assert.deepEqual(sampleFiles(path.join(ws.backup, 'saved_gestures_fsl')), []);
  const cols = queryDb(CLONE_DB,
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${CLONE_DB}' AND TABLE_NAME='gestures' AND COLUMN_NAME='text_en'`);
  assert.equal(cols.length, 0);
});
