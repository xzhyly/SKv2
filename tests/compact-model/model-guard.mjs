// Shared by every browser check that presses Compile on Train Gestures (compact-model phase).
// Compile writes the REAL models/knn_ESL.bin and models/knn_FSL.bin through
// php/api/compile_model.php (Apache cannot be pointed at another folder), so a check copies both
// files first and puts them back byte for byte in its `finally`:
//
//   const guard = guardModels();          // copies both files to a temp folder, records sha256
//   try { ... press Compile ... } finally { const r = guard.restore(); console.log(r.line); }
//
// restore() copies a file back only when its sha256 differs, re-checks the sha256, removes the
// temp copies and returns { ok, line }. It also removes models/*.tmp left by a failed write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MODELS_DIR = path.join(REPO_ROOT, 'models');
export const MODEL_FILES = ['knn_ESL.bin', 'knn_FSL.bin'];
export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export const modelShas = () => MODEL_FILES.map((f) => (fs.existsSync(path.join(MODELS_DIR, f)) ? sha256File(path.join(MODELS_DIR, f)) : null));

export function guardModels() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-models-backup-'));
  const before = {};
  for (const f of MODEL_FILES) {
    const src = path.join(MODELS_DIR, f);
    if (!fs.existsSync(src)) throw new Error(`model-guard: ${src} does not exist; refusing to run a Compile check without it`);
    fs.copyFileSync(src, path.join(tmp, f));
    before[f] = sha256File(src);
    if (sha256File(path.join(tmp, f)) !== before[f]) throw new Error(`model-guard: backup copy of ${f} differs`);
  }
  let done = false;
  function restore() {
    if (done) return { ok: true, line: 'models already restored' };
    const parts = [];
    let ok = true;
    for (const f of MODEL_FILES) {
      const dst = path.join(MODELS_DIR, f);
      const changed = !fs.existsSync(dst) || sha256File(dst) !== before[f];
      if (changed) fs.copyFileSync(path.join(tmp, f), dst);
      const now = sha256File(dst);
      if (now !== before[f]) ok = false;
      parts.push(`${f} ${changed ? 'restored' : 'unchanged'} sha256 ${now.slice(0, 8)}${now === before[f] ? '' : ' (MISMATCH, backup kept in ' + tmp + ')'}`);
    }
    for (const f of fs.readdirSync(MODELS_DIR)) if (f.endsWith('.tmp')) fs.rmSync(path.join(MODELS_DIR, f), { force: true });
    if (ok) { fs.rmSync(tmp, { recursive: true, force: true }); done = true; }
    return { ok, line: parts.join('; '), before };
  }
  return { before, restore, tmp };
}
