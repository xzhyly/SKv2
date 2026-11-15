// js/seq-features.js
// Whole-sign recognition, the math (seq-recognition phase, 2026-11-15, docs/reports/2026-11-15-seq-recognition-final.md).
// No DOM; runs in the browser (window.SeqFeatures) and in node (module.exports).
//
// The frame k-NN (js/sign-to-text-ui.js knnPredict) compares ONE frame's hand shape, so it answers with whatever
// pose the hand is in (usually the last one) and knows nothing about the movement. Here ONE vector describes a whole
// sign, from the hand coming up to the hand stopping or going down:
//   - per frame and per hand, 38 numbers that do not depend on who signs or where the hand is in the picture:
//     14 finger joint angles, 15 fingertip distances (to the wrist and to each other, in palm lengths) and the
//     palm's orientation (3 unit vectors);
//   - the sign is cut into K = 3 equal parts in time (START, MIDDLE, END) and each part is averaged, with where
//     each wrist is (relative to the sign's own centre, in palm lengths) and how far apart the two hands are;
//   - plus each hand's movement from its first to its last frame and its path length.
// 258 numbers. Two signs match only when start, middle AND end agree.
// Hand slots: slot 0 = MediaPipe's "Right", slot 1 = "Left" (two hands with the same label: the second goes to the
// other slot). A model keeps every sample twice, as recorded and mirrored (left-handed signer / mirrored camera).
//
// classify(model, vector): nearest sample (Euclidean distance on standardized values). `ratio` = distance to the
// nearest sample of the best sign / distance to the nearest sample of any OTHER sign: near 1 means two signs fit
// about equally (not sure), small means a clear answer. Measured on the owner's 1,357 samples
// (tools/seq_eval/README.md): same signers 93.4 % correct, a signer never seen 68.1 %.
(function () {
  'use strict';

  var K = 3;
  var HAND_DIMS = 38;
  var SEG_DIMS = HAND_DIMS * 2 + 2 + 6;      // 84
  var DIMS = SEG_DIMS * K + 6;               // 258
  var MIN_FRAMES = 3;
  var INPUT_W = 320, INPUT_H = 240;          // the canvas MediaPipe sees (js/gesture-data.js offscreenCanvas)
  var FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  var TIPS = [4, 8, 12, 16, 20];

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function angle(a, b, c) {
    var u = sub(b, a), v = sub(c, b);
    var n = norm(u) * norm(v);
    var cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.max(n, 1e-9);
    return Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
  }
  function median(list) {
    var s = list.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // frames: [{ hands: [{ label: 'Right'|'Left', landmarks: [21 x {x, y, z}] }] }] (a v3 sample's frames, or live
  // MediaPipe results in the same shape). -> [{ 0: pts|null, 1: pts|null }] in pixels of the input canvas, frames
  // with no hand dropped. opts: { w, h } input canvas (default 320 x 240), { mirror } flips x and swaps the slots.
  function toSlots(frames, opts) {
    opts = opts || {};
    var w = opts.w || INPUT_W, h = opts.h || INPUT_H;
    var out = [];
    (frames || []).forEach(function (fr) {
      var hands = ((fr && fr.hands) || []).filter(function (x) { return x && x.landmarks && x.landmarks.length >= 21; }).slice(0, 2);
      if (!hands.length) return;
      var slots = [null, null];
      hands.forEach(function (hd) {
        var k = hd.label === 'Right' ? 0 : 1;
        if (slots[k]) k = 1 - k;
        slots[k] = hd.landmarks.slice(0, 21).map(function (q) {
          var x = (Number(q.x) || 0) * w;
          return [opts.mirror ? w - x : x, (Number(q.y) || 0) * h, (Number(q.z) || 0) * w];
        });
      });
      out.push(opts.mirror ? [slots[1], slots[0]] : slots);
    });
    return out;
  }

  // 38 numbers for one hand in one frame (pts: 21 x [x, y, z]).
  function handDescriptor(pts) {
    var out = [];
    var w = pts[0];
    var R = pts.map(function (p) { return sub(p, w); });
    var size = Math.max(norm(R[9]), 1e-6);
    FINGERS.forEach(function (f) {
      var chain = f[0] === 1 ? f : [0].concat(f);
      for (var i = 0; i + 2 < chain.length; i++) out.push(angle(pts[chain[i]], pts[chain[i + 1]], pts[chain[i + 2]]) / Math.PI);
    });
    for (var i = 0; i < 5; i++) {
      out.push(norm(R[TIPS[i]]) / size / 3);
      for (var k = i + 1; k < 5; k++) out.push(norm(sub(pts[TIPS[i]], pts[TIPS[k]])) / size / 3);
    }
    var u = R[9].map(function (v) { return v / size; });
    var v = sub(R[17], R[5]);
    var vn = Math.max(norm(v), 1e-6);
    v = v.map(function (x) { return x / vn; });
    var n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    var nn = Math.max(norm(n), 1e-6);
    n = n.map(function (x) { return x / nn; });
    return out.concat(u, v, n);
  }

  // The 258-number vector of one sign, or null when it has fewer than 3 frames with a hand.
  function vector(frames, opts) {
    var S = toSlots(frames, opts);
    var T = S.length;
    if (T < MIN_FRAMES) return null;
    var sizes = [];
    S.forEach(function (fr) { fr.forEach(function (p) { if (p) sizes.push(norm(sub(p[9], p[0]))); }); });
    var size = Math.max(median(sizes), 1e-6);
    var desc = S.map(function (fr) { return [fr[0] ? handDescriptor(fr[0]) : null, fr[1] ? handDescriptor(fr[1]) : null]; });
    var wrist = S.map(function (fr) { return fr.map(function (p) { return p ? [p[0][0] / size, p[0][1] / size] : null; }); });
    var cx = 0, cy = 0, cn = 0;
    wrist.forEach(function (fr) { fr.forEach(function (p) { if (p) { cx += p[0]; cy += p[1]; cn++; } }); });
    cx /= cn; cy /= cn;

    var out = [];
    // K parts, as numpy.array_split: the first T % K parts get one frame more
    var base = Math.floor(T / K), extra = T % K, at = 0;
    for (var s = 0; s < K; s++) {
      var len = base + (s < extra ? 1 : 0);
      var pres = [0, 0], mean = [[], []], wsum = [[0, 0], [0, 0]];
      for (var h = 0; h < 2; h++) for (var d = 0; d < HAND_DIMS; d++) mean[h].push(0);
      for (var t = at; t < at + len; t++) {
        for (h = 0; h < 2; h++) {
          if (!desc[t][h]) continue;
          pres[h]++;
          for (d = 0; d < HAND_DIMS; d++) mean[h][d] += desc[t][h][d];
          wsum[h][0] += wrist[t][h][0]; wsum[h][1] += wrist[t][h][1];
        }
      }
      for (h = 0; h < 2; h++) for (d = 0; d < HAND_DIMS; d++) out.push(len ? mean[h][d] / len : 0);
      out.push(len ? pres[0] / len : 0, len ? pres[1] / len : 0);
      var a = pres[0] ? [wsum[0][0] / pres[0], wsum[0][1] / pres[0]] : null;
      var b = pres[1] ? [wsum[1][0] / pres[1], wsum[1][1] / pres[1]] : null;
      out.push(a ? (a[0] - cx) / 4 : 0, a ? (a[1] - cy) / 4 : 0);
      out.push(b ? (b[0] - cx) / 4 : 0, b ? (b[1] - cy) / 4 : 0);
      out.push(a && b ? (a[0] - b[0]) / 4 : 0, a && b ? (a[1] - b[1]) / 4 : 0);
      at += len;
    }
    for (h = 0; h < 2; h++) {
      var path = [];
      wrist.forEach(function (fr) { if (fr[h]) path.push(fr[h]); });
      if (path.length >= 2) {
        var lenSum = 0;
        for (var i = 1; i < path.length; i++) lenSum += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        out.push((path[path.length - 1][0] - path[0][0]) / 4, (path[path.length - 1][1] - path[0][1]) / 4, lenSum / 8);
      } else out.push(0, 0, 0);
    }
    return out;
  }

  // ── model: { labels: [key], rowLabel: Uint16Array, mu, sd: Float32Array(DIMS), rows: Float32Array(n x DIMS) } ──
  // samples: [{ label, frames, input? }]. Every sample gives 2 rows (as recorded, mirrored); rows are stored
  // standardized ((x - mu) / sd over all rows).
  // opts.segments(frames) -> [frames, ...] (js/seq-recognizer.js segmentsOf): the pieces the live recognizer would
  // cut this sample into (a hold in the middle ends a piece). Each piece is added under the sample's label too, so
  // the model knows a sign as the kiosk will see it, not only as the whole recording.
  function createBuilder(opts) {
    opts = opts || {};
    var vecs = [], labs = [], used = 0, skipped = 0, pieces = 0;
    function addFrames(label, frames, o) {
      var v = vector(frames, o);
      if (!v) return false;
      vecs.push(v, vector(frames, { w: o.w, h: o.h, mirror: true })); labs.push(label, label);
      return true;
    }
    function addSample(label, sample) {
      var input = (sample && sample.input) || {};
      var o = { w: input.width || INPUT_W, h: input.height || INPUT_H };
      if (!addFrames(label, sample && sample.frames, o)) { skipped++; return false; }
      used++;
      if (opts.segments) {
        var segs = opts.segments(sample.frames);
        // one piece that is the whole sample adds nothing new
        if (!(segs.length === 1 && segs[0].length >= sample.frames.filter(function (f) { return f.hands && f.hands.length; }).length)) {
          segs.forEach(function (fr) { if (addFrames(label, fr, o)) pieces++; });
        }
      }
      return true;
    }
    function finish() {
      var labels = Array.from(new Set(labs)).sort();
      var index = {};
      labels.forEach(function (l, i) { index[l] = i; });
      var n = vecs.length;
      var mu = new Float32Array(DIMS), sd = new Float32Array(DIMS);
      var i, d;
      for (i = 0; i < n; i++) for (d = 0; d < DIMS; d++) mu[d] += vecs[i][d] / n;
      for (i = 0; i < n; i++) for (d = 0; d < DIMS; d++) { var x = vecs[i][d] - mu[d]; sd[d] += x * x / n; }
      for (d = 0; d < DIMS; d++) sd[d] = Math.sqrt(sd[d]) + 1e-6;
      var rows = new Float32Array(n * DIMS), rowLabel = new Uint16Array(n);
      for (i = 0; i < n; i++) {
        rowLabel[i] = index[labs[i]];
        for (d = 0; d < DIMS; d++) rows[i * DIMS + d] = (vecs[i][d] - mu[d]) / sd[d];
      }
      return { labels: labels, rowLabel: rowLabel, mu: mu, sd: sd, rows: rows, sampleCount: used, skipped: skipped, pieces: pieces };
    }
    return { addSample: addSample, finish: finish };
  }

  // -> { label, dist, ratio, second, top: [{ label, dist }] (best 5 signs) } or null.
  function classify(model, vec) {
    if (!model || !vec || !model.rowLabel.length) return null;
    var n = model.rowLabel.length, q = new Float32Array(DIMS), d, i;
    for (d = 0; d < DIMS; d++) q[d] = (vec[d] - model.mu[d]) / model.sd[d];
    var best = new Float32Array(model.labels.length).fill(Infinity);
    var rows = model.rows;
    for (i = 0; i < n; i++) {
      var o = i * DIMS, s = 0, lim = best[model.rowLabel[i]];
      for (d = 0; d < DIMS; d++) { var x = rows[o + d] - q[d]; s += x * x; if (s >= lim) break; }
      if (s < lim) best[model.rowLabel[i]] = s;
    }
    var order = [];
    for (i = 0; i < best.length; i++) if (isFinite(best[i])) order.push(i);
    order.sort(function (a, b) { return best[a] - best[b]; });
    if (!order.length) return null;
    var top = order.slice(0, 5).map(function (k) { return { label: model.labels[k], dist: Math.sqrt(best[k]) }; });
    var d1 = top[0].dist, d2 = top.length > 1 ? top[1].dist : Infinity;
    return { label: top[0].label, dist: d1, ratio: d2 === Infinity ? 0 : d1 / Math.max(d2, 1e-9), second: top.length > 1 ? top[1].label : null, top: top };
  }

  // ── file: 'SKSQ' | u32 header bytes | header JSON (utf-8) | pad to 4 | rowLabel u16 x n | pad to 4 | mu f32 x DIMS |
  //    sd f32 x DIMS | rows f32 x n x DIMS (little-endian) ──
  var MAGIC = 'SKSQ';
  function encode(model, meta) {
    var header = Object.assign({ formatVersion: 1, dims: DIMS, k: K, rowCount: model.rowLabel.length, labels: model.labels,
      sampleCount: model.sampleCount }, meta || {});
    var hb = new TextEncoder().encode(JSON.stringify(header));
    var n = model.rowLabel.length;
    var off1 = 8 + hb.length; off1 += (4 - off1 % 4) % 4;
    var off2 = off1 + n * 2; off2 += (4 - off2 % 4) % 4;
    var total = off2 + DIMS * 8 + n * DIMS * 4;
    var buf = new ArrayBuffer(total), u8 = new Uint8Array(buf), dv = new DataView(buf);
    for (var i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
    dv.setUint32(4, hb.length, true);
    u8.set(hb, 8);
    for (i = 0; i < n; i++) dv.setUint16(off1 + i * 2, model.rowLabel[i], true);
    var p = off2;
    [model.mu, model.sd, model.rows].forEach(function (arr) {
      for (var j = 0; j < arr.length; j++) { dv.setFloat32(p, arr[j], true); p += 4; }
    });
    return buf;
  }
  function decode(buffer) {
    var u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) throw new Error('seq model file: not an SKSQ file');
    var hl = dv.getUint32(4, true);
    if (8 + hl > u8.length) throw new Error('seq model file: header is cut off');
    var header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
    if (header.formatVersion !== 1 || header.dims !== DIMS || header.k !== K) throw new Error('seq model file: made by another version (dims ' + header.dims + ', k ' + header.k + ')');
    var n = header.rowCount;
    var off1 = 8 + hl; off1 += (4 - off1 % 4) % 4;
    var off2 = off1 + n * 2; off2 += (4 - off2 % 4) % 4;
    if (off2 + DIMS * 8 + n * DIMS * 4 !== u8.length) throw new Error('seq model file: wrong size');
    var rowLabel = new Uint16Array(n);
    for (var i = 0; i < n; i++) rowLabel[i] = dv.getUint16(off1 + i * 2, true);
    function f32(at, len) { var a = new Float32Array(len); for (var j = 0; j < len; j++) a[j] = dv.getFloat32(at + j * 4, true); return a; }
    return { header: header, labels: header.labels, rowLabel: rowLabel, mu: f32(off2, DIMS), sd: f32(off2 + DIMS * 4, DIMS),
      rows: f32(off2 + DIMS * 8, n * DIMS), sampleCount: header.sampleCount };
  }

  var api = { K: K, DIMS: DIMS, MIN_FRAMES: MIN_FRAMES, INPUT_W: INPUT_W, INPUT_H: INPUT_H, toSlots: toSlots,
    handDescriptor: handDescriptor, vector: vector, createBuilder: createBuilder, classify: classify, encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SeqFeatures = api;
})();
