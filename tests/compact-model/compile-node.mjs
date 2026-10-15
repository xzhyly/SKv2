// Node twin of Train Gestures' Compile (compact-model phase): builds models/knn_<LANG>.bin from a
// save_gesture.php listing with the same js/knn-compile.js and the real recordingToFeatureRows.
// Used by tests and to produce the first model files; the owner compiles from Train Gestures.
//
// Run: node tests/compact-model/compile-node.mjs [--lang ESL|FSL|both] [--out <dir>]
//        [--listing <file.json[.gz]> | --fixture]      (default: the live full-sync GET)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO_ROOT, loadKnnCompile, loadToRows, loadFixtureListing } from './fixtures.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const langs = (opt('--lang', 'both') === 'both') ? ['ESL', 'FSL'] : [opt('--lang')];
const outDir = path.resolve(opt('--out', path.join(REPO_ROOT, 'models')));

export async function getListing() {
  if (args.includes('--fixture')) return loadFixtureListing();
  const file = opt('--listing', null);
  if (file) {
    const buf = fs.readFileSync(file);
    return JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
  }
  const res = await fetch('http://localhost/SKR/php/api/save_gesture.php');
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error('listing failed: ' + (json.error || res.status));
  return json;
}

export async function compileLang(listing, lang, K = loadKnnCompile(), toRows = loadToRows()) {
  const built = K.buildModel({ gestures: listing.gestures, signs: listing.signs, categories: listing.categories, lang, toRows });
  built.header.fingerprint = await K.sha256Hex(built.fingerprintText);
  return { header: built.header, buffer: K.encode(built.header, built.model) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const listing = await getListing();
  fs.mkdirSync(outDir, { recursive: true });
  for (const lang of langs) {
    const { header, buffer } = await compileLang(listing, lang);
    const dest = path.join(outDir, `knn_${lang}.bin`);
    fs.writeFileSync(dest + '.tmp', Buffer.from(buffer));
    fs.renameSync(dest + '.tmp', dest);
    console.log(`${lang}: ${header.labels.length} labels, ${header.sampleCount} samples, ${header.rowCount} rows, ${buffer.byteLength} bytes -> ${dest} (fingerprint ${header.fingerprint})`);
  }
}
