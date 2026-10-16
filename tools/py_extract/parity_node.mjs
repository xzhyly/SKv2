// tools/py_extract/parity_node.mjs
// For tools/py_extract/parity.py: runs the page's own code on cached Hands results, so the
// comparison never uses a second copy of the normalisation or of the split.
// stdin: a JSON list of hands.json paths (bulk_import_cache/videos/<id>.hands.json, format 2).
// stdout: one JSON answer per path, in order:
//   {frames, hands: [hands per frame], features: [126 numbers | null per frame],
//    split: {ok, reasons, reps: [{index, startFrame, endFrame, startMs, endMs}]}}
// features: GestureDataRecorder.recordingToFeatureRows() of the frame alone (js/gesture-data.js):
// the per-frame normalisation the samples go through; null for a frame without a hand.
// split: BulkRepSplit.splitReps() (js/bulk-rep-split.js) with the arguments of splitOf() in
// js/bulk-import-ui.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadGestureData } from '../../tests/video-capture/load-gesture-data.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Split = require(path.join(REPO, 'js', 'bulk-rep-split.js'));
const G = loadGestureData(fs.readFileSync(path.join(REPO, 'js', 'gesture-data.js'), 'utf8'));

function splitOf(frames, hm) {
  const input = (hm && hm.input) || {};
  return Split.splitReps(frames, { fps: hm && hm.fps, aspect: input.width && input.height ? input.width / input.height : 4 / 3 });
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = files.map((file) => {
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  const frames = Array.isArray(h.frames) ? h.frames : [];
  const split = splitOf(frames, h.meta || {});
  return {
    frames: frames.length,
    hands: frames.map((f) => (Array.isArray(f.hands) ? f.hands.length : 0)),
    features: frames.map((f) => {
      if (!Array.isArray(f.hands) || !f.hands.length) return null;
      const row = G.recordingToFeatureRows({ frames: [f] })[0];
      return row ? row.map(r6) : null;
    }),
    split: {
      ok: !!split.ok, reasons: split.reasons,
      reps: split.reps.map((r) => ({ index: r.index, startFrame: r.startFrame, endFrame: r.endFrame, startMs: r.startMs, endMs: r.endMs })),
    },
  };
});
process.stdout.write(JSON.stringify(out));
