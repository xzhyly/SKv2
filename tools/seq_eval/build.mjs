// tools/seq_eval/build.mjs — builds models/seq_ESL.bin and models/seq_FSL.bin from a saved_gestures folder with
// node (the same result as Train Gestures -> Compile, which also writes them; use this when the samples are on
// another machine than the one that compiles).   node tools/seq_eval/build.mjs <saved_gestures folder> [out folder]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SF = require('../../js/seq-features.js');
const dir = process.argv[2], out = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), '../../models');
if (!dir) { console.error('usage: node tools/seq_eval/build.mjs <saved_gestures folder> [out folder]'); process.exit(2); }
const inModel = (lang, label, set) => set === lang || set === 'BOTH' || label === 'start' || label === 'stop';
for (const lang of ['ESL', 'FSL']) {
  const SR = require('../../js/seq-recognizer.js'); const b = SF.createBuilder({ segments: SR.segmentsOf }); let files = 0;
  for (const label of fs.readdirSync(dir).sort()) {
    const d = path.join(dir, label);
    if (!fs.statSync(d).isDirectory()) continue;
    let sign = {};
    try { sign = JSON.parse(fs.readFileSync(path.join(d, 'sign.json'), 'utf8')); } catch { /* no sign.json: the sample's own set */ }
    for (const f of fs.readdirSync(d).filter((x) => /^sample_.*\.json$/.test(x)).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const set = String(sign.set || j.signLanguage || 'ESL').toUpperCase();
      if (!inModel(lang, label, set)) continue;
      files++; b.addSample(label, j);
    }
  }
  const m = b.finish();
  const buf = SF.encode(m, { lang, buildDate: new Date().toISOString(), builtOn: 'node tools/seq_eval/build.mjs' });
  fs.writeFileSync(path.join(out, `seq_${lang}.bin`), Buffer.from(buf));
  const back = SF.decode(fs.readFileSync(path.join(out, `seq_${lang}.bin`)).buffer.slice(0));
  console.log(`${lang}: ${m.labels.length} signs, ${m.sampleCount} of ${files} samples (${m.skipped} with < 3 hand frames), ${m.pieces} extra pieces, ${m.rowLabel.length} rows, ${buf.byteLength} bytes; read back ${back.rowLabel.length} rows`);
}
