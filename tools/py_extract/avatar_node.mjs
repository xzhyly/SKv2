// tools/py_extract/avatar_node.mjs
// For tools/py_extract/avatar_pass.py: the page's own code for everything around the Holistic
// pass, so the Python avatar pass has no second copy of the split, the best-rep rule, the frame
// packing, auto-trim or the clip format.
// stdin: a JSON list of requests; stdout: the JSON list of answers, in order.
//   {op: 'info'}
//     -> {splitVersion: BulkRepSplit.SPLIT.VERSION, metaVersion: BulkImportCore.META_VERSION}
//   {op: 'split', handsPath, meta, row, nowIso}
//     The page's "split from the cache" (processVideo() plan 'resplit', js/bulk-import-ui.js): the
//     cached frames as a Hands result, splitOf() (BulkRepSplit.splitReps), then
//     BulkImportCore.buildMeta() with the cached source. row: {id, name, size, lastModified,
//     relPath, parsed} as the page's row. -> {ok: true, meta} | {ok: false, reason}
//   {op: 'candidate', key, signer, holistic: {frames, fps, video, firstFrame}, createdAt, source}
//     frames: one [pose|null, leftHand|null, rightHand|null] per grid frame, pose = 33 x
//     [x, y, z, visibility], hands = 21 x [x, y, z], unrounded (Holistic's own numbers).
//     Each frame goes through AvatarClip.packFrame() (POSE_IDX subset, rounding) and the result
//     through BulkImportCore.buildCandidate() (auto-trim, buildClip, trim times of the window,
//     validateClip), exactly as candidateStep() in js/bulk-import-ui.js. clip.extractor then names
//     the Python build (source). -> {ok: true, clip} | {ok: false, reason}
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Core = require(path.join(REPO, 'js', 'bulk-import-core.js'));
const Split = require(path.join(REPO, 'js', 'bulk-rep-split.js'));
const Clip = require(path.join(REPO, 'js', 'avatar-clip.js'));

// splitOf() of js/bulk-import-ui.js
function splitOf(frames, hm) {
  const input = (hm && hm.input) || {};
  return Split.splitReps(frames, { fps: hm && hm.fps, aspect: input.width && input.height ? input.width / input.height : 4 / 3 });
}

// cachedHands() + the 'resplit' branch of processVideo() (js/bulk-import-ui.js)
function split(q) {
  const h = JSON.parse(fs.readFileSync(q.handsPath, 'utf8'));
  if (!Array.isArray(h.frames) || !h.meta) return { ok: false, reason: 'no frames in the cache' };
  const hm = h.meta;
  const cached = { videoWidth: hm.videoWidth, videoHeight: hm.videoHeight, fps: hm.fps, durationMs: hm.durationMs, input: hm.input, frames: h.frames };
  const meta = q.meta;
  if (!cached.durationMs) cached.durationMs = meta.hands.durationMs;
  return { ok: true, meta: Core.buildMeta(q.row, cached, splitOf(cached.frames, cached), meta.hands.ms || 0, meta, Core.cacheSource(meta).text, q.nowIso) };
}

const xyz = (p) => ({ x: p[0], y: p[1], z: p[2] });
function results(f) {
  return {
    poseLandmarks: f[0] ? f[0].map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] })) : undefined,
    leftHandLandmarks: f[1] ? f[1].map(xyz) : undefined,
    rightHandLandmarks: f[2] ? f[2].map(xyz) : undefined,
  };
}

function candidate(q) {
  const h = q.holistic;
  const built = Core.buildCandidate({
    key: q.key, signer: q.signer, AvatarClip: Clip, createdAt: q.createdAt,
    holistic: { frames: h.frames.map((f) => Clip.packFrame(results(f))), fps: h.fps, video: h.video, firstFrame: h.firstFrame },
  });
  if (!built.ok) return built;
  built.clip.extractor = { lib: q.source, modelComplexity: 1 };
  return built;
}

const ops = {
  info: () => ({ splitVersion: Split.SPLIT.VERSION, metaVersion: Core.META_VERSION }),
  split,
  candidate,
};

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(input.map((q) => {
  try {
    return ops[q.op](q);
  } catch (e) {
    return { ok: false, reason: 'node: ' + (e && e.message ? e.message : String(e)) };
  }
})));
