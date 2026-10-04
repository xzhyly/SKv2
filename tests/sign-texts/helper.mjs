// Helpers for the sign-texts migration test (db-schema/migrations/2026-10-04-sign-texts.php).
// Everything runs against a disposable clone database and temp copies of the dataset; the live
// `sining_kamay_db` and the repo's saved_gestures*/ folders are never touched.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PHP, MYSQL, LIVE_DB, repo, dropDb, mysqlCli, queryDb } from '../normalization/clone-helper.mjs';

export { queryDb, dropDb, LIVE_DB };

export const MIGRATION = path.join(repo, 'db-schema', 'migrations', '2026-10-04-sign-texts.php');
export const BACKUP_BASE = 'E:\\ACADSS\\IOT\\backups\\2026-10-04-sign-texts';
export const SOURCE_DUMP = process.env.SK_SIGNTEXTS_SOURCE_DUMP
  || path.join(BACKUP_BASE, 'sining_kamay_db_before-sign-texts.sql');
export const DATASET_COPY = path.join(BACKUP_BASE, 'dataset-copy');
export const CLONE_DB = 'sining_kamay_db_sttest';

export const SKIP_REASON = !fs.existsSync(SOURCE_DUMP)
  ? `source dump not found: ${SOURCE_DUMP} (set SK_SIGNTEXTS_SOURCE_DUMP)`
  : !fs.existsSync(path.join(DATASET_COPY, 'saved_gestures')) || !fs.existsSync(path.join(DATASET_COPY, 'saved_gestures_fsl'))
    ? `dataset copy not found under ${DATASET_COPY}`
    : false;

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Restores SOURCE_DUMP into a fresh database. Refuses a dump that names a database, so a wrong
// dump can never be restored on top of the live DB.
export function cloneFromDump(name) {
  if (name === LIVE_DB) throw new Error('refusing to clone onto the live database');
  const sql = fs.readFileSync(SOURCE_DUMP);
  const text = sql.toString('utf8');
  if (/^\s*USE\s/im.test(text) || /CREATE\s+DATABASE/i.test(text)) {
    throw new Error(`refusing to restore ${SOURCE_DUMP}: it contains a USE or CREATE DATABASE statement`);
  }
  dropDb(name);
  mysqlCli(['-e', `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`]);
  const r = spawnSync(MYSQL, ['-uroot', '--default-character-set=utf8mb4', name], { input: sql, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`restore failed: ${r.stderr}`);
}

// A fresh temp dataset root (copy of the pre-migration dataset) and a fresh empty backup dir.
export function makeWorkspace(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `sk-signtexts-${tag}-`));
  const root = path.join(base, 'root');
  const backup = path.join(base, 'backup');
  fs.mkdirSync(root);
  fs.mkdirSync(backup);
  fs.cpSync(path.join(DATASET_COPY, 'saved_gestures'), path.join(root, 'saved_gestures'), { recursive: true });
  fs.cpSync(path.join(DATASET_COPY, 'saved_gestures_fsl'), path.join(root, 'saved_gestures_fsl'), { recursive: true });
  return { base, root, backup };
}

export function runMigration(db, ws, extra = []) {
  const r = spawnSync(PHP, [MIGRATION, `--db=${db}`, `--root=${ws.root}`, `--backup-dir=${ws.backup}`, '--no-dump-check', ...extra],
    { encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Every sample_*.json file under dir (recursive), as paths relative to dir with forward slashes.
export function sampleFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^sample_.*\.json$/.test(e.name)) out.push(path.relative(dir, p).replace(/\\/g, '/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

// Comparable end state: DB rows, sign.json contents (minus updatedAt), manifest (backup paths
// made relative to the backup dir), and the file lists of the dataset and the backup.
export function endState(db, ws) {
  const gestures = queryDb(db, 'SELECT id, label, sign_language, text_en, text_fil, category, asset_path, is_active, created_at FROM gestures ORDER BY id');
  const recordings = queryDb(db, 'SELECT id, gesture_id, frame_count, sample_path, recorded_at, MD5(landmark_json) AS md5 FROM gesture_recordings ORDER BY id');
  const signs = {};
  const eslDir = path.join(ws.root, 'saved_gestures');
  for (const f of fs.readdirSync(eslDir, { withFileTypes: true })) {
    if (!f.isDirectory()) continue;
    const p = path.join(eslDir, f.name, 'sign.json');
    if (fs.existsSync(p)) {
      const { updatedAt, ...rest } = JSON.parse(fs.readFileSync(p, 'utf8'));
      signs[f.name] = rest;
    }
  }
  const mp = path.join(ws.backup, 'moved-manifest.json');
  const manifest = (fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : []).map(e => ({
    ...e, backup: path.relative(ws.backup, e.backup).replace(/\\/g, '/'),
  }));
  return {
    gestures, recordings, signs, manifest,
    eslFiles: sampleFiles(path.join(ws.root, 'saved_gestures')),
    fslFiles: sampleFiles(path.join(ws.root, 'saved_gestures_fsl')),
    backupFiles: sampleFiles(path.join(ws.backup, 'saved_gestures_fsl')),
  };
}
