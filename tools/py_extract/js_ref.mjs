// tools/py_extract/js_ref.mjs
// Answers the same questions as tools/py_extract/skcore.py, with the page's real JavaScript, so
// test_skcore.py can check that both give the same answer. Reads a JSON list of
// {fn, args} on stdin, writes the list of answers as JSON on stdout.
//   parseName / cleanLabel / skipFolder: js/bulk-import-core.js
//   videoId: SHA-256 (first 32 hex) of BulkImportCore.videoIdSource(), as sha32() in
//            js/bulk-import-ui.js (UTF-8 bytes; node's hash gives the same bytes as crypto.subtle)
//   junk: JUNK_RE, read from the source of js/bulk-import-ui.js
//   letterboxRect: js/gesture-data.js; seekTimes: js/video-landmarks.js; mathRound: Math.round
//   features: GestureDataRecorder.recordingToFeatureRows() of one frame
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadGestureData } from '../../tests/video-capture/load-gesture-data.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Core = require(path.join(REPO, 'js', 'bulk-import-core.js'));
const VL = require(path.join(REPO, 'js', 'video-landmarks.js'));
const G = loadGestureData(fs.readFileSync(path.join(REPO, 'js', 'gesture-data.js'), 'utf8'));
const ui = fs.readFileSync(path.join(REPO, 'js', 'bulk-import-ui.js'), 'utf8');
const JUNK_RE = eval(/var JUNK_RE = (\/.*\/[a-z]*);/.exec(ui)[1]);

const fns = {
  parseName: (name) => Core.parseName(name),
  cleanLabel: (s) => Core.cleanLabel(s),
  skipFolder: (rel) => Core.skipFolder(rel),
  videoId: (name, size, lastModified) =>
    crypto.createHash('sha256').update(Core.videoIdSource({ name, size, lastModified }), 'utf8').digest('hex').slice(0, 32),
  junk: (name) => JUNK_RE.test(name),
  letterboxRect: (a, b, c, d) => G.letterboxRect(a, b, c, d),
  seekTimes: (d, fps) => VL.seekTimes(d, fps),
  mathRound: (x) => Math.round(x),
  features: (frame) => G.recordingToFeatureRows({ frames: [frame] })[0] || null,
};

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(input.map((q) => fns[q.fn](...q.args))));
