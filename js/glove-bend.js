// js/glove-bend.js
// Glove-assisted recognition, the math (glove-hw Phase 2, docs/superpowers/specs/2026-10-21-glove-hardware-design.md
// 2.1-2.2). No DOM; runs in the browser (window.GloveBend) and in node (module.exports).
//
// bendOfSlot(row, slot): how bent each finger of one hand slot of a k-NN model row is, 0 = straight .. 1 = fully
// bent, from joint angles. A model row is 126 numbers = 2 hand slots x 21 points x (x, y, z), wrist-relative and
// scaled (js/gesture-data.js flattenHand); a slot of all zeros has no hand. Angles do not change with that scaling
// or with knnPredict's x-mirror. RANGES: the per-finger angle sums at "open" and "bent", measured on
// models/knn_ESL.bin (14,492 rows, 2026-10-21) as the 10th and 98th percentiles.
//
// rerank(scores, model, gloves, w): lowers the k-NN score of the top 5 labels by w x how far the glove's finger
// bend is from that label's rows (mean of its 5 closest rows). gloves: the glove hands to compare, 1 or 2 arrays
// of 5 values 0..1 or null (null fingers are skipped). Rows store hands in MediaPipe's order, not by left/right,
// so both slot orders are tried and the closer one counts.
(function () {
  'use strict';

  var TOP_LABELS = 5;
  var BEST_ROWS = 5;
  // [open, bent] angle sums in degrees, thumb..pinky (measured, see above)
  var RANGES = [[14, 96], [21, 232], [20, 264], [20, 286], [25, 275]];
  // joints per finger as [a, b, c]: the angle at b between a->b and b->c
  var JOINTS = [
    [[1, 2, 3], [2, 3, 4]],
    [[0, 5, 6], [5, 6, 7], [6, 7, 8]],
    [[0, 9, 10], [9, 10, 11], [10, 11, 12]],
    [[0, 13, 14], [13, 14, 15], [14, 15, 16]],
    [[0, 17, 18], [17, 18, 19], [18, 19, 20]]
  ];
  var DEG = 180 / Math.PI;

  function angleAt(row, o, a, b, c) {
    var ux = row[o + b * 3] - row[o + a * 3], uy = row[o + b * 3 + 1] - row[o + a * 3 + 1], uz = row[o + b * 3 + 2] - row[o + a * 3 + 2];
    var vx = row[o + c * 3] - row[o + b * 3], vy = row[o + c * 3 + 1] - row[o + b * 3 + 1], vz = row[o + c * 3 + 2] - row[o + b * 3 + 2];
    var n = Math.sqrt(ux * ux + uy * uy + uz * uz) * Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!n) return 0;
    var cos = (ux * vx + uy * vy + uz * vz) / n;
    return Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos) * DEG;
  }

  // [5] bends 0..1 for hand slot 0 or 1 of a 126-number row, or null when the slot is empty.
  function bendOfSlot(row, slot) {
    var o = slot * 63;
    var empty = true;
    for (var i = o; i < o + 63; i++) { if (row[i] !== 0) { empty = false; break; } }
    if (empty) return null;
    return JOINTS.map(function (joints, f) {
      var sum = 0;
      joints.forEach(function (j) { sum += angleAt(row, o, j[0], j[1], j[2]); });
      var x = (sum - RANGES[f][0]) / (RANGES[f][1] - RANGES[f][0]);
      return x < 0 ? 0 : x > 1 ? 1 : x;
    });
  }

  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  // { a: [5]|null, b: [5]|null } for a row, cached with the row (computed the first time it is needed).
  function rowBends(row) {
    var hit = cache && cache.get(row);
    if (hit) return hit;
    var rb = { a: bendOfSlot(row, 0), b: bendOfSlot(row, 1) };
    if (cache) cache.set(row, rb);
    return rb;
  }

  // Mean |glove - row| over the fingers both have, for one pairing of gloves with row slots; null if none.
  function pairDistance(pairs) {
    var sum = 0, n = 0;
    pairs.forEach(function (p) {
      if (!p[0] || !p[1]) return;
      for (var i = 0; i < 5; i++) {
        if (p[0][i] === null || p[0][i] === undefined) continue;
        sum += Math.abs(p[0][i] - p[1][i]);
        n++;
      }
    });
    return n ? sum / n : null;
  }
  // Distance between the glove hands and one row: the closer of the two slot orders; null if nothing compares.
  function rowDistance(rb, gloves) {
    var g0 = gloves[0] || null, g1 = gloves[1] || null;
    var d1 = pairDistance([[g0, rb.a], [g1, rb.b]]);
    var d2 = pairDistance([[g0, rb.b], [g1, rb.a]]);
    if (d1 === null) return d2;
    if (d2 === null) return d1;
    return Math.min(d1, d2);
  }
  // A label's glove distance: the mean of its BEST_ROWS closest rows; null if no row compares.
  function labelDistance(rows, gloves) {
    var ds = [];
    for (var i = 0; i < rows.length; i++) {
      var d = rowDistance(rowBends(rows[i]), gloves);
      if (d !== null) ds.push(d);
    }
    if (!ds.length) return null;
    ds.sort(function (x, y) { return x - y; });
    var k = Math.min(BEST_ROWS, ds.length), s = 0;
    for (var j = 0; j < k; j++) s += ds[j];
    return s / k;
  }

  // scores: { label: 0..1 } (knnPredict's normalized scores). Returns { scores, dist } with a new scores object;
  // the input is never changed. gloves: 1-2 arrays of 5 (0..1 or null). w: 0..1.
  function rerank(scores, model, gloves, w) {
    var out = {};
    for (var l in scores) out[l] = scores[l];
    var dist = {};
    if (!model || !gloves || !gloves.length || !(w > 0)) return { scores: out, dist: dist };
    var top = Object.keys(scores).sort(function (x, y) { return scores[y] - scores[x]; }).slice(0, TOP_LABELS);
    top.forEach(function (l) {
      var rows = model[l];
      if (!rows || !rows.length) return;
      var d = labelDistance(rows, gloves);
      if (d === null) return;
      dist[l] = d;
      var v = scores[l] - w * d;
      out[l] = v < 0 ? 0 : v;
    });
    return { scores: out, dist: dist };
  }

  var api = { RANGES: RANGES, TOP_LABELS: TOP_LABELS, BEST_ROWS: BEST_ROWS, bendOfSlot: bendOfSlot, rowBends: rowBends,
    rowDistance: rowDistance, labelDistance: labelDistance, rerank: rerank };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GloveBend = api;
})();
