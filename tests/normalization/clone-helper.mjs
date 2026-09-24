// Helpers for testing the one-time DB-normalization migration
// (db-schema/migrations/2026-09-24-normalize.php) against disposable clone
// databases. Never touches the live `sining_kamay_db` except to read from it
// via mysqldump for cloning.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..');

export const PHP = process.env.SK_PHP_CLI || 'C:\\xampp\\php\\php.exe';
export const PHP_CGI = process.env.SK_PHP_CGI || 'C:\\xampp\\php\\php-cgi.exe';
export const MYSQL = process.env.SK_MYSQL || 'C:\\xampp\\mysql\\bin\\mysql.exe';
export const MYSQLDUMP = process.env.SK_MYSQLDUMP || 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
export const LIVE_DB = 'sining_kamay_db';
export const MIGRATION_SCRIPT = path.join(repo, 'db-schema', 'migrations', '2026-09-24-normalize.php');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

export function mysqlCli(args, opts = {}) {
  const r = run(MYSQL, ['-uroot', ...args], opts);
  if (r.status !== 0) throw new Error(`mysql.exe failed: ${r.stderr}${r.stdout}`);
  return r;
}

export function dropDb(name) {
  mysqlCli(['-e', `DROP DATABASE IF EXISTS \`${name}\``]);
}

// Clones LIVE_DB into a freshly (re)created database named `name` via a real
// mysqldump | mysql restore, through a temp file (piping was awkward to make
// robust cross-platform with spawnSync).
export function cloneLiveDb(name) {
  dropDb(name);
  mysqlCli(['-e', `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`]);
  const tmpFile = path.join(os.tmpdir(), `sk-clone-${name}-${process.pid}-${Date.now()}.sql`);
  const dump = run(MYSQLDUMP, ['-uroot', '--single-transaction', '--default-character-set=utf8mb4', LIVE_DB]);
  if (dump.status !== 0) throw new Error(`mysqldump.exe failed: ${dump.stderr}`);
  fs.writeFileSync(tmpFile, dump.stdout, 'utf8');
  try {
    const restore = run(MYSQL, ['-uroot', '--default-character-set=utf8mb4', name], { input: fs.readFileSync(tmpFile) });
    if (restore.status !== 0) throw new Error(`mysql.exe restore failed: ${restore.stderr}${restore.stdout}`);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

// Runs arbitrary SQL against `dbName` (any database, not just the live one)
// via PHP CLI + php/connect.php, returning parsed JSON rows (empty array for
// non-SELECT statements).
export function queryDb(dbName, sql) {
  const script = `
    require ${JSON.stringify(path.join(repo, 'php', 'connect.php'))};
    if (!mysqli_select_db($conn, ${JSON.stringify(dbName)})) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    $res = mysqli_query($conn, ${JSON.stringify(sql)});
    if ($res === false) { fwrite(STDERR, mysqli_error($conn)); exit(1); }
    $rows = [];
    if ($res instanceof mysqli_result) { while ($row = mysqli_fetch_assoc($res)) { $rows[] = $row; } }
    echo json_encode($rows);
  `;
  const r = spawnSync(PHP, ['-r', script], { encoding: 'utf8', cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`queryDb(${dbName}) failed: ${r.stderr}${r.stdout}`);
  return JSON.parse(r.stdout);
}

export const execDb = queryDb;

// Runs the migration script under the real PHP CLI (as the owner will run it
// on the Pi/XAMPP), against `dbName`, with extra CLI args.
export function runMigration(dbName, extraArgs = [], { snapshotPath } = {}) {
  const args = [MIGRATION_SCRIPT, `--db=${dbName}`];
  if (snapshotPath) args.push(`--snapshot=${snapshotPath}`);
  args.push(...extraArgs);
  const r = spawnSync(PHP, args, { encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function tmpSnapshotPath(tag) {
  return path.join(os.tmpdir(), `sk-migtest-snapshot-${tag}-${process.pid}-${Date.now()}.json`);
}

// Runs a PHP script under php-cgi exactly as Apache would (GET, no body), to
// exercise the `if (PHP_SAPI !== 'cli')` guard.
export function runUnderCgi(scriptPath) {
  const env = {
    ...process.env,
    REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'GET',
    SCRIPT_FILENAME: scriptPath, SCRIPT_NAME: '/SKR/' + path.relative(repo, scriptPath).replace(/\\/g, '/'),
    QUERY_STRING: '',
  };
  const r = spawnSync(PHP_CGI, [], { env, cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Full post-migration state of a fully-migrated clone: two arrays, ordered by
// id, suitable for assert.deepEqual across two independently-migrated clones
// of the same source dump (ids are preserved by mysqldump, so order matches).
export function postMigrationState(dbName) {
  const gestures = queryDb(dbName,
    'SELECT id, label, sign_language, category, asset_path, is_active, created_at FROM gestures ORDER BY id');
  const recordings = queryDb(dbName,
    'SELECT id, gesture_id, sample_path, frame_count, landmark_json, recorded_at FROM gesture_recordings ORDER BY id');
  return { gestures, recordings };
}

export function showCreateTable(dbName, table) {
  const rows = queryDb(dbName, `SHOW CREATE TABLE \`${table}\``);
  return rows[0]['Create Table'];
}

// Strips the volatile AUTO_INCREMENT=N clause so DDL from clones with
// different next-id counters can still be compared for structural equality.
export function normalizeDdl(ddl) {
  return ddl.replace(/\s*AUTO_INCREMENT=\d+/i, '');
}

export function tableList(dbName) {
  return queryDb(dbName,
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${dbName}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`)
    .map(r => r.TABLE_NAME);
}
